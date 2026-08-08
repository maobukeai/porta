/**
 * Shared metadata and disk-scanning utilities for the proxy.
 */

import { readdir, stat, readFile } from "node:fs/promises";
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
}

export async function peekDiskConversationMetadata(
  conversationId: string,
): Promise<DiskPeekMetadata> {
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
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "USER_INPUT" && parsed.content) {
            let rawText = String(parsed.content);
            const userReqMatch = rawText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
            if (userReqMatch) {
              rawText = userReqMatch[1].trim();
            }
            rawText = rawText.replace(/^\/[a-zA-Z0-9_\-\u4e00-\u9fa5]+\s*/, "").trim();
            if (rawText) {
              summary = rawText.slice(0, 60);
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      if (summary || stepCount > 0) {
        return { summary, stepCount };
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
