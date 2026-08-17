/**
 * Shared metadata and disk-scanning utilities for the proxy.
 */

import { readdir, stat, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LSInstance } from "./discovery.js";

export interface ConversationWorkspaceMetadata {
  workspaceFolderAbsoluteUri?: string;
  gitRootAbsoluteUri?: string;
  repository?: {
    computedName?: string;
    gitOriginUrl?: string;
  };
  branchName?: string;
}

const KNOWN_APP_DATA_DIRS = ["antigravity", "antigravity-ide"] as const;

function conversationDirForAppDataDir(appDataDir: string): string {
  return join(homedir(), ".gemini", appDataDir, "conversations");
}

const CONVERSATIONS_DIRS = KNOWN_APP_DATA_DIRS.map(conversationDirForAppDataDir);

const CONVERSATION_EXTENSIONS = [".pb", ".db"] as const;

function conversationIdFromFilename(file: string): string | undefined {
  const extension = CONVERSATION_EXTENSIONS.find((ext) => file.endsWith(ext));
  return extension ? file.slice(0, -extension.length) : undefined;
}

/**
 * Build the metadata object that the LS requires on write RPCs.
 * Mirrors what the VS Code extension sends via MetadataProvider.
 */
export async function getMetadata(
  fileAccessGranted = false,
): Promise<Record<string, unknown>> {
  const meta: Record<string, unknown> = {
    ideName: "porta",
    ideVersion: "0.1.0",
    extensionVersion: "0.1.0",
  };
  if (fileAccessGranted) {
    meta.allowFileAccess = true;
    meta.allWorkspaceTrustGranted = true;
  }
  return meta;
}

/** Scan disk for conversation files not loaded in memory */
export async function scanDiskConversations(
  conversationsDirs: string | string[] = CONVERSATIONS_DIRS,
): Promise<
  { id: string; mtime: string }[]
> {
  const dirs = Array.isArray(conversationsDirs)
    ? conversationsDirs
    : [conversationsDirs];
  const results = new Map<string, { id: string; mtime: string }>();

  for (const conversationsDir of dirs) {
    try {
      const files = await readdir(conversationsDir);
      for (const file of files) {
        const id = conversationIdFromFilename(file);
        if (!id) continue;
        try {
          const s = await stat(join(conversationsDir, file));
          const mtime = s.mtime.toISOString();
          const existing = results.get(id);
          if (!existing || existing.mtime < mtime) {
            results.set(id, { id, mtime });
          }
        } catch {
          results.set(id, { id, mtime: new Date().toISOString() });
        }
      }
    } catch {
      // Conversation dir missing or unreadable
    }
  }

  return [...results.values()];
}

export interface DiskPeekMetadata {
  summary?: string;
  stepCount?: number;
  isSubagent?: boolean;
}

/**
 * Conversation IDs are 36-character UUIDs. Anything else must never be joined
 * into a disk path — a crafted ID like `../../..` would otherwise traverse
 * out of the brain directory (read or, worse, recursive delete).
 */
export function isValidConversationId(id: string | undefined | null): boolean {
  return (
    typeof id === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)
  );
}

export function isSubagentContent(text: string): boolean {
  if (!text) return false;
  let testStr = text.trim();
  const m = testStr.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (m) {
    testStr = m[1].trim();
  } else if (testStr.startsWith("{") && testStr.endsWith("}")) {
    try {
      const parsed = JSON.parse(testStr);
      if (parsed.content) {
        const m2 = String(parsed.content).match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        testStr = m2 ? m2[1].trim() : String(parsed.content).trim();
      }
    } catch {}
  }

  return (
    /^你是【.*Agent/i.test(testStr) ||
    /^你是【.*智能体/i.test(testStr) ||
    /^你是【/i.test(testStr) ||
    /^你是一个子智能体/i.test(testStr) ||
    testStr.startsWith("[Subagent]") ||
    testStr.startsWith("subagent:") ||
    testStr.startsWith("子智能体") ||
    /^🤖\s*子智能体/i.test(testStr)
  );
}

// ── In-Memory File Mtime Caches ──
const transcriptSubagentsMtimeCache = new Map<string, { mtimeMs: number; subagentIds: string[] }>();
const diskPeekMtimeCache = new Map<string, { mtimeMs: number; data: { summary?: string; stepCount?: number; isSubagent?: boolean } }>();

let cachedSubagentIds: Set<string> | null = null;
let lastSubagentScanTime = 0;

const PERSISTENT_SUBAGENTS_FILE = join(homedir(), ".gemini", "antigravity", "known_subagents.json");

/** In-memory mirror of the persistent file, loaded once on first use. */
let persistentSubagentIds: Set<string> | null = null;

async function ensurePersistentSubagentIds(): Promise<Set<string>> {
  if (persistentSubagentIds === null) {
    persistentSubagentIds = await loadPersistentSubagentIds();
  }
  return persistentSubagentIds;
}

async function loadPersistentSubagentIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(PERSISTENT_SUBAGENTS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return new Set(arr.filter((id): id is string => typeof id === "string" && id.length > 0));
    }
  } catch {}
  return new Set();
}

async function savePersistentSubagentIds(ids: Set<string>): Promise<void> {
  try {
    await writeFile(PERSISTENT_SUBAGENTS_FILE, JSON.stringify(Array.from(ids)), "utf-8");
  } catch {}
}

export async function registerSubagentConversationId(id: string): Promise<void> {
  if (!id) return;
  if (cachedSubagentIds) cachedSubagentIds.add(id);
  const ids = await ensurePersistentSubagentIds();
  if (!ids.has(id)) {
    ids.add(id);
    await savePersistentSubagentIds(ids);
  }
}

export async function getAllKnownSubagentConversationIds(forceRefresh = false): Promise<Set<string>> {
  const now = Date.now();
  if (cachedSubagentIds && !forceRefresh && now - lastSubagentScanTime < 10000) {
    return cachedSubagentIds;
  }

  const subagentIds = new Set<string>();

  for (const appDataDir of KNOWN_APP_DATA_DIRS) {
    const brainDir = join(homedir(), ".gemini", appDataDir, "brain");
    try {
      const convDirs = await readdir(brainDir, { withFileTypes: true });
      for (const ent of convDirs) {
        if (!ent.isDirectory() || ent.name.length !== 36) continue;
        const convId = ent.name;
        const transcript = join(brainDir, convId, ".system_generated", "logs", "transcript.jsonl");
        try {
          const s = await stat(transcript);
          const cached = transcriptSubagentsMtimeCache.get(transcript);
          if (cached && cached.mtimeMs === s.mtimeMs) {
            for (const id of cached.subagentIds) {
              subagentIds.add(id);
            }
            continue;
          }

          const content = await readFile(transcript, "utf-8");
          const fileSubagentIds: string[] = [];
          const lines = content.split("\n").filter(Boolean);

          if (lines.length > 0) {
            try {
              const firstStep = JSON.parse(lines[0]);
              if (firstStep.type === "USER_INPUT") {
                if (isSubagentContent(firstStep.content || lines[0])) {
                  fileSubagentIds.push(convId);
                  subagentIds.add(convId);
                }
              }
            } catch {}
          }

          for (const line of lines) {
            if (line.includes("Created the following subagents") || line.includes('"invoke_subagent"')) {
              try {
                const parsed = JSON.parse(line);
                const raw = parsed.content || JSON.stringify(parsed);
                const matches = raw.matchAll(/"conversationId":\s*"([0-9a-fA-F-]{36})"/g);
                for (const m of matches) {
                  const childId = m[1];
                  if (childId !== convId) {
                    fileSubagentIds.push(childId);
                    subagentIds.add(childId);
                  }
                }
              } catch {}
            }
            if (line.includes("sender=") && (line.includes("SYSTEM_MESSAGE") || line.includes('"source":"SYSTEM"'))) {
              try {
                const parsed = JSON.parse(line);
                const raw = parsed.content || JSON.stringify(parsed);
                const senderMatches = raw.matchAll(/sender=([0-9a-fA-F-]{36})/g);
                for (const sm of senderMatches) {
                  const childId = sm[1];
                  if (childId !== convId) {
                    fileSubagentIds.push(childId);
                    subagentIds.add(childId);
                  }
                }
              } catch {}
            }
          }
          transcriptSubagentsMtimeCache.set(transcript, {
            mtimeMs: s.mtimeMs,
            subagentIds: fileSubagentIds,
          });
        } catch {}
      }
    } catch {}
  }

  cachedSubagentIds = subagentIds;
  lastSubagentScanTime = now;

  // Restore previously registered IDs and persist only when the set actually
  // changed — avoids rewriting the file on every 10s scan.
  try {
    const persisted = await ensurePersistentSubagentIds();
    let changed = false;
    for (const id of persisted) {
      if (!subagentIds.has(id)) {
        subagentIds.add(id);
      }
    }
    for (const id of subagentIds) {
      if (!persisted.has(id)) {
        persisted.add(id);
        changed = true;
      }
    }
    if (changed) {
      await savePersistentSubagentIds(persisted);
    }
  } catch {}

  return subagentIds;
}

export async function peekDiskConversationMetadata(
  conversationId: string,
): Promise<{ summary?: string; stepCount?: number; isSubagent?: boolean }> {
  if (!isValidConversationId(conversationId)) return {};
  const knownSubagents = await getAllKnownSubagentConversationIds();
  if (knownSubagents.has(conversationId)) {
    return { isSubagent: true };
  }

  for (const appDataDir of KNOWN_APP_DATA_DIRS) {
    const transcriptPath = join(
      homedir(),
      ".gemini",
      appDataDir,
      "brain",
      conversationId,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    try {
      const s = await stat(transcriptPath);
      const cached = diskPeekMtimeCache.get(transcriptPath);
      if (cached && cached.mtimeMs === s.mtimeMs) {
        return cached.data;
      }

      const content = await readFile(transcriptPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const stepCount = lines.length;

      let summary: string | undefined;
      let isSubagent = false;

      for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const line = lines[i];
        if (isSubagentContent(line)) {
          isSubagent = true;
        }

        try {
          const parsed = JSON.parse(line);
          if (!summary && parsed.type === "USER_INPUT" && parsed.content) {
            let rawText = String(parsed.content)
              .replace(/<user_safety_directive[\s\S]*?<\/user_safety_directive>\s*/gi, "")
              .replace(/\[System (?:Safety )?Directive:[^\]]*\]\s*/gi, "")
              .trim();
            const userReqMatch = rawText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
            if (userReqMatch) {
              rawText = userReqMatch[1].trim();
            }
            rawText = rawText.replace(/^\/[a-zA-Z0-9_\-\u4e00-\u9fa5]+\s*/, "").trim();
            if (rawText) {
              summary = rawText.slice(0, 60);
            }
            if (isSubagentContent(rawText)) {
              isSubagent = true;
            }
          }
        } catch {}
      }

      if (summary && isSubagentContent(summary)) {
        isSubagent = true;
      }

      if (isSubagent) {
        void registerSubagentConversationId(conversationId);
      }

      const result = (summary || stepCount > 0 || isSubagent) ? { summary, stepCount, isSubagent } : {};
      diskPeekMtimeCache.set(transcriptPath, { mtimeMs: s.mtimeMs, data: result });
      return result;
    } catch {
      // file missing
    }
  }

  return {};
}

export async function getConversationSubagentIds(conversationId: string): Promise<string[]> {
  if (!isValidConversationId(conversationId)) return [];
  const subagentIds = new Set<string>();
  for (const appDataDir of KNOWN_APP_DATA_DIRS) {
    const transcriptPath = join(
      homedir(),
      ".gemini",
      appDataDir,
      "brain",
      conversationId,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    try {
      const content = await readFile(transcriptPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.includes("conversationId") || line.includes("invoke_subagent") || line.includes("sender=")) {
          const matches = line.matchAll(/"conversationId":\s*"([0-9a-fA-F-]{36})"/g);
          for (const m of matches) {
            if (m[1] !== conversationId) subagentIds.add(m[1]);
          }
          const senderMatches = line.matchAll(/sender=([0-9a-fA-F-]{36})/g);
          for (const sm of senderMatches) {
            if (sm[1] !== conversationId) subagentIds.add(sm[1]);
          }
        }
      }
    } catch {}
  }
  return Array.from(subagentIds);
}

export async function deleteDiskConversation(conversationId: string): Promise<void> {
  // Guard against path traversal: never rm anything outside the brain dir.
  if (!isValidConversationId(conversationId)) return;
  for (const appDataDir of KNOWN_APP_DATA_DIRS) {
    const brainDir = join(homedir(), ".gemini", appDataDir, "brain", conversationId);
    try {
      await rm(brainDir, { recursive: true, force: true });
    } catch {}

    const convDir = join(homedir(), ".gemini", appDataDir, "conversations");
    for (const ext of CONVERSATION_EXTENSIONS) {
      const pbFile = join(convDir, `${conversationId}${ext}`);
      try {
        await rm(pbFile, { force: true });
      } catch {}
    }
  }
}

export interface DiskConversationStepsResult {
  steps: Record<string, unknown>[];
  offset: number;
  stepCount: number;
}

export async function readDiskConversationSteps(
  conversationId: string,
  offset = 0,
  limit = 100,
): Promise<DiskConversationStepsResult | null> {
  if (!isValidConversationId(conversationId)) return null;
  for (const appDataDir of KNOWN_APP_DATA_DIRS) {
    const transcriptPath = join(
      homedir(),
      ".gemini",
      appDataDir,
      "brain",
      conversationId,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    try {
      const content = await readFile(transcriptPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;

      const steps: Record<string, unknown>[] = [];
      const slicedLines = lines.slice(offset, offset + limit);

      for (let idx = 0; idx < slicedLines.length; idx++) {
        const rawLine = slicedLines[idx];
        const stepIndex = offset + idx;
        try {
          const parsed = JSON.parse(rawLine);
          const rawType = parsed.type || "PLANNER_RESPONSE";
          const type =
            rawType === "USER_INPUT"
              ? "CORTEX_STEP_TYPE_USER_INPUT"
              : rawType === "PLANNER_RESPONSE"
              ? "CORTEX_STEP_TYPE_PLANNER_RESPONSE"
              : `CORTEX_STEP_TYPE_${rawType}`;

          let contentStr = String(parsed.content || "");
          if (rawType === "USER_INPUT") {
            const userReqMatch = contentStr.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
            if (userReqMatch) {
              contentStr = userReqMatch[1].trim();
            }
          }

          const stepObj: Record<string, unknown> = {
            stepIndex,
            type,
          };

          if (rawType === "USER_INPUT") {
            stepObj.userPrompt = {
              text: contentStr,
              items: [{ text: contentStr }],
            };
          } else {
            stepObj.plannerResponse = {
              text: contentStr,
              items: [{ text: contentStr }],
              toolCalls: parsed.tool_calls || parsed.toolCalls || [],
            };
          }

          steps.push(stepObj);
        } catch {
          steps.push({
            stepIndex,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            plannerResponse: { text: "（步骤解析中）", items: [{ text: "（步骤解析中）" }] },
          });
        }
      }

      return {
        steps,
        offset,
        stepCount: lines.length,
      };
    } catch {
      // missing file
    }
  }

  return null;
}

export function conversationDirsForAppDataDirs(
  appDataDirs: Iterable<string | undefined>,
): string[] {
  const known = new Set<string>(KNOWN_APP_DATA_DIRS);
  const dirs = new Set<string>();

  for (const appDataDir of appDataDirs) {
    if (appDataDir && known.has(appDataDir)) {
      dirs.add(conversationDirForAppDataDir(appDataDir));
    }
  }

  return [...dirs];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function workspaceArray(value: unknown): ConversationWorkspaceMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((workspace) => ({
    ...(typeof workspace.workspaceFolderAbsoluteUri === "string"
      ? { workspaceFolderAbsoluteUri: workspace.workspaceFolderAbsoluteUri }
      : {}),
    ...(typeof workspace.gitRootAbsoluteUri === "string"
      ? { gitRootAbsoluteUri: workspace.gitRootAbsoluteUri }
      : {}),
    ...(isRecord(workspace.repository)
      ? {
          repository: {
            ...(typeof workspace.repository.computedName === "string"
              ? { computedName: workspace.repository.computedName }
              : {}),
            ...(typeof workspace.repository.gitOriginUrl === "string"
              ? { gitOriginUrl: workspace.repository.gitOriginUrl }
              : {}),
          },
        }
      : {}),
    ...(typeof workspace.branchName === "string"
      ? { branchName: workspace.branchName }
      : {}),
  }));
}

/**
 * Extract workspace metadata from a conversation summary.
 *
 * Antigravity 1.x exposed this at `summary.workspaces`. Antigravity 2.x still
 * exposes that for loaded conversations, but also mirrors it under
 * `summary.trajectoryMetadata.workspaces` and may only expose URI strings in
 * `summary.trajectoryMetadata.workspaceUris`.
 */
export function extractConversationWorkspaces(
  summary: unknown,
): ConversationWorkspaceMetadata[] {
  if (!isRecord(summary)) return [];

  const topLevel = workspaceArray(summary.workspaces);
  if (topLevel.length > 0) return topLevel;

  const trajectoryMetadata = summary.trajectoryMetadata;
  if (!isRecord(trajectoryMetadata)) return [];

  const metadataWorkspaces = workspaceArray(trajectoryMetadata.workspaces);
  if (metadataWorkspaces.length > 0) return metadataWorkspaces;

  if (!Array.isArray(trajectoryMetadata.workspaceUris)) return [];
  return trajectoryMetadata.workspaceUris
    .filter((uri): uri is string => typeof uri === "string")
    .map((uri) => ({ workspaceFolderAbsoluteUri: uri }));
}

export function getPrimaryWorkspaceUri(summary: unknown): string | undefined {
  return extractConversationWorkspaces(summary)[0]?.workspaceFolderAbsoluteUri;
}

export function withNormalizedConversationWorkspaces<T extends Record<string, unknown>>(
  summary: T,
): T {
  if (Array.isArray(summary.workspaces) && summary.workspaces.length > 0) {
    return summary;
  }

  const workspaces = extractConversationWorkspaces(summary);
  if (workspaces.length === 0) return summary;
  return { ...summary, workspaces };
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

let cachedProjectNameMap: Map<string, string> | null = null;
let lastProjectNameMapScanTime = 0;

export async function getProjectNameMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedProjectNameMap && now - lastProjectNameMapScanTime < 10000) {
    return cachedProjectNameMap;
  }

  const map = new Map<string, string>();
  const projectsDir = join(homedir(), ".gemini", "config", "projects");
  try {
    const files = await readdir(projectsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await readFile(join(projectsDir, file), "utf8");
          const data = JSON.parse(content);
          if (data.id && data.name) {
            map.set(data.id, safeDecodeUriComponent(data.name));
          }
        } catch {
          // ignore invalid json
        }
      }
    }
  } catch {
    // projects dir missing or unreadable
  }
  cachedProjectNameMap = map;
  lastProjectNameMapScanTime = now;
  return map;
}

export async function getProjectPermissionPreset(
  workspaceUri?: string,
): Promise<string | undefined> {
  if (!workspaceUri) return undefined;
  const projectsDir = join(homedir(), ".gemini", "config", "projects");
  try {
    const files = await readdir(projectsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = join(projectsDir, file);
      try {
        const content = await readFile(fullPath, "utf-8");
        const data = JSON.parse(content);
        const resources = data.projectResources?.resources ?? [];
        for (const res of resources) {
          const folderUri = res.gitFolder?.folderUri;
          if (
            folderUri &&
            (folderUri.toLowerCase() === workspaceUri.toLowerCase() ||
              decodeURIComponent(folderUri).toLowerCase() ===
                decodeURIComponent(workspaceUri).toLowerCase())
          ) {
            return data.settings?.permissionPreset;
          }
        }
      } catch {}
    }
  } catch {}
  return undefined;
}

function normalizeUriPath(uri?: string): string {
  if (!uri) return "";
  try {
    return decodeURIComponent(uri)
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/^file:\/\/\/?([a-z]):/i, "file:///$1:")
      .replace(/%3a/gi, ":")
      .replace(/\/+$/, "");
  } catch {
    return uri.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

export async function syncProjectPermissionPreset(
  workspaceUri?: string,
  preset?: string | number,
  rpcClient?: { call: (method: string, body?: Record<string, unknown>, instance?: LSInstance) => Promise<unknown> },
  instance?: LSInstance,
): Promise<void> {
  let presetEnum = "AGENT_PERMISSION_PRESET_DEFAULT";
  if (preset === "AGENT_PERMISSION_PRESET_DEFAULT" || preset === 1 || preset === "auto_edit") {
    presetEnum = "AGENT_PERMISSION_PRESET_DEFAULT";
  } else if (preset === "AGENT_PERMISSION_PRESET_REQUEST_REVIEW" || preset === 2 || preset === "review_before_edit" || preset === "planning") {
    presetEnum = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
  } else if (preset === "AGENT_PERMISSION_PRESET_TURBO" || preset === 3 || preset === "full_access") {
    presetEnum = "AGENT_PERMISSION_PRESET_TURBO";
  } else if (preset === "AGENT_PERMISSION_PRESET_VETTED" || preset === 4) {
    presetEnum = "AGENT_PERMISSION_PRESET_VETTED";
  }

  const isRequestReview = presetEnum === "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
  const projectsDir = join(homedir(), ".gemini", "config", "projects");
  const cwdNorm = normalizeUriPath(process.cwd());
  const normWs = normalizeUriPath(workspaceUri);

  try {
    const files = await readdir(projectsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = join(projectsDir, file);
      try {
        const content = await readFile(fullPath, "utf-8");
        const data = JSON.parse(content);
        const resources = data.projectResources?.resources ?? [];
        let matched = false;
        for (const res of resources) {
          const folderUri = res.gitFolder?.folderUri || res.folderUri;
          const normFolder = normalizeUriPath(folderUri);
          if (
            (normWs && normFolder && (normFolder === normWs || normFolder.includes(normWs) || normWs.includes(normFolder))) ||
            (!normWs && normFolder && (normFolder.includes(cwdNorm) || cwdNorm.includes(normFolder)))
          ) {
            matched = true;
            if (res.gitFolder) {
              res.gitFolder.allowWrite = !isRequestReview;
            }
          }
        }
        if (matched) {
          data.settings = data.settings || {};
          data.settings.permissionPreset = presetEnum;
          data.updatedAt = new Date().toISOString();

          if (rpcClient) {
            try {
              await rpcClient.call("UpdateProject", { project: data }, instance);
            } catch {
              await writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
            }
          } else {
            await writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
          }
          break;
        }
      } catch {}
    }
  } catch {}
}
