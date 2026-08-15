import type { ChatMessage, TrajectoryStep } from "../types";

export interface TurnFileChange {
  name: string;
  path: string;
  fullPath: string;
  ext: string;
  additions: number;
  deletions: number;
}

export interface TurnArtifactItem {
  id: string;
  title: string;
  type: "walkthrough" | "plan" | "doc" | "other";
  path?: string;
  rawLink?: string;
}

export interface TurnSummaryData {
  files: TurnFileChange[];
  totalAdditions: number;
  totalDeletions: number;
  artifacts: TurnArtifactItem[];
  timestamp?: string;
}

function cleanFilePath(rawPath?: string): { name: string; dir: string; fullPath: string; ext: string } {
  if (!rawPath) return { name: "file", dir: "", fullPath: "", ext: "" };
  let decoded = "";
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  const clean = decoded.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
  const name = clean.split("/").pop() || "file";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

  // Extract clean directory path representation
  let dir = "";
  const pkgIdx = clean.indexOf("packages/");
  const srcIdx = clean.indexOf("src/");
  if (pkgIdx !== -1) {
    const sub = clean.slice(pkgIdx);
    const parts = sub.split("/");
    dir = parts.slice(0, -1).join("/") + "/";
  } else if (srcIdx !== -1) {
    const sub = clean.slice(srcIdx);
    const parts = sub.split("/");
    dir = parts.slice(0, -1).join("/") + "/";
  } else {
    const parts = clean.split("/").filter(Boolean);
    const dirParts = parts.slice(0, -1);
    if (dirParts.length > 0) {
      dir = dirParts.slice(-3).join("/") + "/";
    }
  }

  return { name, dir, fullPath: clean, ext };
}

function countLines(text?: unknown): number {
  if (!text || typeof text !== "string") return 0;
  return text.split("\n").length;
}

function parseToolCallEdits(toolCall: any): { path: string; additions: number; deletions: number } | null {
  if (!toolCall) return null;
  const name = toolCall.name || "";
  let args = toolCall.args;
  if (!args && toolCall.argumentsJson) {
    try {
      args = JSON.parse(toolCall.argumentsJson);
    } catch {}
  }
  if (!args && toolCall.arguments) {
    args = toolCall.arguments;
  }
  if (!args) return null;

  const rawPath = args.TargetFile || args.targetFile || args.path || args.filename || args.file_path;
  if (!rawPath || typeof rawPath !== "string") return null;

  let additions = 0;
  let deletions = 0;

  // 1. multi_replace_file_content with ReplacementChunks
  if (Array.isArray(args.ReplacementChunks) && args.ReplacementChunks.length > 0) {
    for (const chunk of args.ReplacementChunks) {
      if (chunk.TargetContent) {
        deletions += countLines(chunk.TargetContent);
      }
      if (chunk.ReplacementContent) {
        additions += countLines(chunk.ReplacementContent);
      }
    }
    return { path: rawPath, additions, deletions };
  }

  // 2. replace_file_content with TargetContent / ReplacementContent
  if (args.TargetContent || args.ReplacementContent) {
    if (args.TargetContent) deletions += countLines(args.TargetContent);
    if (args.ReplacementContent) additions += countLines(args.ReplacementContent);
    return { path: rawPath, additions, deletions };
  }

  // 3. write_to_file / create_file with CodeContent
  if (args.CodeContent || args.content || args.code) {
    additions += countLines(args.CodeContent || args.content || args.code);
    return { path: rawPath, additions, deletions };
  }

  // 4. Fallback if tool name is edit-related
  if (name.includes("replace") || name.includes("write") || name.includes("edit") || name.includes("create")) {
    return { path: rawPath, additions: 1, deletions: 0 };
  }

  return null;
}

function parseCodeAction(step: TrajectoryStep): { path: string; additions: number; deletions: number } | null {
  const ca = step.codeAction;
  if (!ca) return null;

  const rawPath = ca.actionResult?.edit?.absoluteUri;
  const lines = ca.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];
  let additions = 0;
  let deletions = 0;

  if (lines.length > 0) {
    for (const l of lines) {
      if (l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT") additions++;
      else if (l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE") deletions++;
    }
  }

  if (rawPath) {
    return { path: rawPath, additions, deletions };
  }
  return null;
}

/** Extract turn completion artifacts (Walkthrough, Implementation Plan, etc.) */
function extractArtifactsFromTurn(
  stepMessages: ChatMessage[],
  assistantMessage?: ChatMessage,
): TurnArtifactItem[] {
  const artifacts: TurnArtifactItem[] = [];
  const seen = new Set<string>();

  const addArtifact = (item: TurnArtifactItem) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      artifacts.push(item);
    }
  };

  // 1. Scan assistant response content for markdown artifact links
  const content = assistantMessage?.content || "";
  if (content) {
    // Match [Label](file:///path/to/artifact.md) or [Label](artifact.md) or file paths
    const linkRegex = /\[([^\]]+)\]\((file:\/\/\/[^)]+|[^)]+\.md)\)/gi;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const label = match[1].trim();
      const target = match[2].trim();
      const lower = label.toLowerCase();
      const targetLower = target.toLowerCase();

      let type: TurnArtifactItem["type"] = "doc";
      let title = label;

      if (lower.includes("walkthrough") || targetLower.includes("walkthrough")) {
        type = "walkthrough";
        title = "Walkthrough";
      } else if (lower.includes("plan") || targetLower.includes("plan")) {
        type = "plan";
        title = label.includes("Plan") || label.includes("计划") ? label : "Implementation Plan";
      }

      addArtifact({
        id: `link-${target}`,
        title,
        type,
        path: target,
        rawLink: match[0],
      });
    }
  }

  // 2. Scan tool calls in stepMessages for created artifact files
  for (const sm of stepMessages) {
    const step = sm.step;
    if (!step) continue;

    const toolCall = step.metadata?.toolCall;
    if (toolCall) {
      let args = toolCall.args;
      if (!args && toolCall.argumentsJson) {
        try {
          args = JSON.parse(toolCall.argumentsJson);
        } catch {}
      }
      if (args) {
        const path = args.TargetFile || args.targetFile || args.path || "";
        if (typeof path === "string") {
          const lower = path.toLowerCase();
          if (lower.includes("walkthrough.md")) {
            addArtifact({
              id: `tool-${path}`,
              title: "Walkthrough",
              type: "walkthrough",
              path,
            });
          } else if (lower.includes("implementation_plan.md") || lower.includes("plan.md")) {
            addArtifact({
              id: `tool-${path}`,
              title: "Implementation Plan",
              type: "plan",
              path,
            });
          }
        }
      }
    }
  }

  return artifacts;
}

/**
 * Extracts all file changes and artifact references generated across a chat turn.
 */
export function extractTurnSummary(
  stepMessages: ChatMessage[],
  assistantMessage?: ChatMessage,
): TurnSummaryData {
  const fileMap = new Map<string, TurnFileChange>();

  // 1. Process all steps in the turn
  for (const sm of stepMessages) {
    const step = sm.step;
    if (!step) continue;

    // Check code action
    const caEdit = parseCodeAction(step);
    if (caEdit) {
      const { name, dir, fullPath, ext } = cleanFilePath(caEdit.path);
      const existing = fileMap.get(fullPath) || {
        name,
        path: dir,
        fullPath,
        ext,
        additions: 0,
        deletions: 0,
      };
      existing.additions += caEdit.additions;
      existing.deletions += caEdit.deletions;
      fileMap.set(fullPath, existing);
    }

    // Check metadata toolCall
    const tcEdit = parseToolCallEdits(step.metadata?.toolCall);
    if (tcEdit) {
      const { name, dir, fullPath, ext } = cleanFilePath(tcEdit.path);
      // Skip markdown artifacts from file changes list if they are in brain/walkthrough
      const isBrainArtifact = fullPath.includes(".gemini/antigravity/brain") || fullPath.includes("brain/");
      if (!isBrainArtifact) {
        const existing = fileMap.get(fullPath) || {
          name,
          path: dir,
          fullPath,
          ext,
          additions: 0,
          deletions: 0,
        };
        existing.additions += tcEdit.additions;
        existing.deletions += tcEdit.deletions;
        fileMap.set(fullPath, existing);
      }
    }

    // Check planner response toolCalls
    if (step.plannerResponse?.toolCalls) {
      for (const tc of step.plannerResponse.toolCalls) {
        const edit = parseToolCallEdits(tc);
        if (edit) {
          const { name, dir, fullPath, ext } = cleanFilePath(edit.path);
          const isBrainArtifact = fullPath.includes(".gemini/antigravity/brain") || fullPath.includes("brain/");
          if (!isBrainArtifact) {
            const existing = fileMap.get(fullPath) || {
              name,
              path: dir,
              fullPath,
              ext,
              additions: 0,
              deletions: 0,
            };
            existing.additions += edit.additions;
            existing.deletions += edit.deletions;
            fileMap.set(fullPath, existing);
          }
        }
      }
    }
  }

  const files = Array.from(fileMap.values());
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const artifacts = extractArtifactsFromTurn(stepMessages, assistantMessage);

  // Extract turn timestamp (e.g. "12:53")
  let timestamp: string | undefined;
  const lastStep = assistantMessage?.step || (stepMessages.length > 0 ? stepMessages[stepMessages.length - 1].step : undefined);
  if (lastStep?.metadata?.completedAt || lastStep?.metadata?.createdAt) {
    const rawDate = new Date(lastStep.metadata.completedAt || lastStep.metadata.createdAt!);
    if (!isNaN(rawDate.getTime())) {
      const hours = String(rawDate.getHours()).padStart(2, "0");
      const minutes = String(rawDate.getMinutes()).padStart(2, "0");
      timestamp = `${hours}:${minutes}`;
    }
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    artifacts,
    timestamp,
  };
}
