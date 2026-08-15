/**
 * Shared metadata and disk-scanning utilities for the proxy.
 */

import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

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

let cachedSubagentIds: Set<string> | null = null;
let lastSubagentScanTime = 0;

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
        if (!ent.isDirectory()) continue;
        const transcript = join(brainDir, ent.name, ".system_generated", "logs", "transcript.jsonl");
        try {
          const content = await readFile(transcript, "utf-8");
          const lines = content.split("\n").filter(Boolean);
          for (const line of lines) {
            if (line.includes("conversationId") || line.includes("invoke_subagent")) {
              try {
                const parsed = JSON.parse(line);
                const raw = parsed.content || JSON.stringify(parsed);
                const matches = raw.matchAll(/"conversationId":\s*"([0-9a-fA-F-]{36})"/g);
                for (const m of matches) {
                  subagentIds.add(m[1]);
                }
              } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  cachedSubagentIds = subagentIds;
  lastSubagentScanTime = now;
  return subagentIds;
}

export async function peekDiskConversationMetadata(
  conversationId: string,
): Promise<{ summary?: string; stepCount?: number; isSubagent?: boolean }> {
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
      const content = await readFile(transcriptPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const stepCount = lines.length;

      let summary: string | undefined;
      let isSubagent = false;

      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        try {
          const parsed = JSON.parse(line);
          const raw = JSON.stringify(parsed);
          if (
            raw.includes('"isSubagent":true') ||
            raw.includes("parentTrajectoryId") ||
            raw.includes("parentCascadeId") ||
            raw.includes("invoke_subagent") ||
            raw.includes("subagent:") ||
            raw.includes("Usage Statistics Auditor")
          ) {
            isSubagent = true;
          }

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
          }
        } catch {}
      }

      if (summary || stepCount > 0 || isSubagent) {
        return { summary, stepCount, isSubagent };
      }
    } catch {
      // file missing
    }
  }

  return {};
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

export async function getProjectNameMap(): Promise<Map<string, string>> {
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
  rpcClient?: { call: (method: string, body?: Record<string, unknown>, instance?: any) => Promise<unknown> },
  instance?: any,
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
            (!normWs && normFolder && (normFolder.includes(cwdNorm) || cwdNorm.includes(normFolder))) ||
            (data.name === "antigravity移动端")
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
