import type { TrajectoryStep } from "../types";

export interface RevertFileChange {
  fileUri: string;
  fileName: string;
  ext: string;
  additions: number;
  deletions: number;
  isCreated?: boolean;
}

/** Normalize newlines to LF (\n) */
export function normalizeNewlines(str: string): string {
  return (str || "").replace(/\r\n/g, "\n");
}

/** Extract file basename and extension */
export function parsePath(uriOrPath: string): { fileName: string; ext: string } {
  const cleaned = uriOrPath.replace(/^file:\/\//, "").replace(/\\/g, "/");
  const fileName = cleaned.split("/").pop() || cleaned;
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return { fileName, ext };
}

/**
 * Robust replacement helper that handles Windows CRLF vs LF and minor whitespace differences
 */
export function applyReplacement(source: string, target: string, replacement: string): string {
  const normSource = normalizeNewlines(source);
  const normTarget = normalizeNewlines(target);
  const normRepl = normalizeNewlines(replacement);

  if (normSource.includes(normTarget)) {
    return normSource.replace(normTarget, normRepl);
  }

  // Fallback: line-by-line trimmed matching
  const sourceLines = normSource.split("\n");
  const targetLines = normTarget.split("\n");

  if (targetLines.length > 0) {
    const firstTargetLine = targetLines[0].trim();
    for (let i = 0; i <= sourceLines.length - targetLines.length; i++) {
      if (sourceLines[i].trim() === firstTargetLine) {
        let match = true;
        for (let j = 1; j < targetLines.length; j++) {
          if (sourceLines[i + j].trim() !== targetLines[j].trim()) {
            match = false;
            break;
          }
        }
        if (match) {
          sourceLines.splice(i, targetLines.length, ...normRepl.split("\n"));
          return sourceLines.join("\n");
        }
      }
    }
  }

  return normSource;
}

/**
 * Compute exact additions (+X) and deletions (-Y) using LCS (Longest Common Subsequence) diff
 * between current full file lines and target checkpoint full file lines.
 */
export function computeLcsDiffCounts(
  currentLines: string[],
  targetLines: string[],
): { additions: number; deletions: number } {
  const m = currentLines.length;
  const n = targetLines.length;
  if (m === 0 && n === 0) return { additions: 0, deletions: 0 };
  if (m === 0) return { additions: n, deletions: 0 };
  if (n === 0) return { additions: 0, deletions: m };

  const maxLines = 5000;
  const cur = currentLines.length > maxLines ? currentLines.slice(0, maxLines) : currentLines;
  const tar = targetLines.length > maxLines ? targetLines.slice(0, maxLines) : targetLines;

  const M = cur.length;
  const N = tar.length;
  const dp: number[][] = Array.from({ length: M + 1 }, () => new Int32Array(N + 1) as unknown as number[]);

  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      if (cur[i] === tar[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lcs = dp[M][N];
  return {
    additions: N - lcs, // Lines in target checkpoint that will be restored (+additions)
    deletions: M - lcs, // Lines in current version that will be deleted (-deletions)
  };
}

interface FileTracker {
  fileUri: string;
  fileName: string;
  ext: string;
  currentContent: string | null;
  history: Array<{ stepIndex: number; content: string | null }>;
  hunkDiffs: Array<{ stepIndex: number; adds: number; dels: number }>;
  isExplicitlyCreated: boolean;
  firstSeenStepIndex: number;
}

/**
 * Replay all steps to maintain full file content snapshots,
 * and calculate the exact 2-way full-file LCS diff for revert.
 */
export function extractRevertFileChanges(
  steps: TrajectoryStep[] = [],
  targetStepIndex: number,
  baseOffset = 0,
): RevertFileChange[] {
  if (!Array.isArray(steps) || targetStepIndex < 0) return [];

  const trackers = new Map<string, FileTracker>();

  const getOrCreateTracker = (uriOrPath: string, stepIdx: number): FileTracker => {
    const { fileName, ext } = parsePath(uriOrPath);
    let t = trackers.get(fileName);
    if (!t) {
      t = {
        fileUri: uriOrPath,
        fileName,
        ext,
        currentContent: null,
        history: [],
        hunkDiffs: [],
        isExplicitlyCreated: false,
        firstSeenStepIndex: stepIdx,
      };
      trackers.set(fileName, t);
    }
    return t;
  };

  // Replay all steps chronologically
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const absIdx =
      step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? (baseOffset + i);

    // 1. Check Tool Call for full file edits
    const toolCall = step.metadata?.toolCall;
    if (toolCall?.argumentsJson) {
      try {
        const args = JSON.parse(toolCall.argumentsJson);
        const path = args.TargetFile || args.targetFile || args.path || args.filename;
        if (path) {
          const tracker = getOrCreateTracker(path, absIdx);

          if (toolCall.name === "write_to_file" && typeof args.CodeContent === "string") {
            tracker.currentContent = normalizeNewlines(args.CodeContent);
            tracker.history.push({ stepIndex: absIdx, content: tracker.currentContent });
          } else if (
            toolCall.name === "replace_file_content" &&
            typeof args.TargetContent === "string" &&
            typeof args.ReplacementContent === "string"
          ) {
            if (tracker.currentContent !== null) {
              tracker.currentContent = applyReplacement(
                tracker.currentContent,
                args.TargetContent,
                args.ReplacementContent,
              );
              tracker.history.push({ stepIndex: absIdx, content: tracker.currentContent });
            }
          } else if (
            toolCall.name === "multi_replace_file_content" &&
            Array.isArray(args.ReplacementChunks)
          ) {
            if (tracker.currentContent !== null) {
              let updated = tracker.currentContent;
              for (const chunk of args.ReplacementChunks) {
                if (chunk.TargetContent && chunk.ReplacementContent) {
                  updated = applyReplacement(
                    updated,
                    chunk.TargetContent,
                    chunk.ReplacementContent,
                  );
                }
              }
              tracker.currentContent = updated;
              tracker.history.push({ stepIndex: absIdx, content: tracker.currentContent });
            }
          }
        }
      } catch {}
    }

    // 2. Check CodeAction for diff statistics and create flags
    if (step.codeAction) {
      const ca = step.codeAction;
      const fileUri =
        ca.actionResult?.edit?.absoluteUri ||
        ca.actionSpec?.createFile?.path?.absoluteUri ||
        "";
      if (fileUri) {
        const tracker = getOrCreateTracker(fileUri, absIdx);
        const lines = ca.actionResult?.edit?.diff?.unifiedDiff?.lines || [];
        const adds = lines.filter(
          (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT",
        ).length;
        const dels = lines.filter(
          (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE",
        ).length;

        if (ca.actionResult?.edit?.createFile || ca.actionSpec?.createFile) {
          tracker.isExplicitlyCreated = true;
        }

        tracker.hunkDiffs.push({ stepIndex: absIdx, adds, dels });
      }
    }
  }

  const result: RevertFileChange[] = [];

  for (const tracker of trackers.values()) {
    // Check if this file was modified in steps AFTER targetStepIndex
    const modifiedAfter =
      tracker.history.some((h) => h.stepIndex > targetStepIndex) ||
      tracker.hunkDiffs.some((hd) => hd.stepIndex > targetStepIndex);

    if (!modifiedAfter) continue;

    // Check history snapshots
    const historyBeforeTarget = tracker.history
      .filter((h) => h.stepIndex <= targetStepIndex)
      .pop();
    const latestHistory = tracker.history[tracker.history.length - 1];

    // 1. If we have full snapshots both at/before targetStep and latest:
    if (
      historyBeforeTarget &&
      latestHistory &&
      historyBeforeTarget.content !== null &&
      latestHistory.content !== null
    ) {
      const targetLines = historyBeforeTarget.content.split("\n");
      const currentLines = latestHistory.content.split("\n");
      const { additions, deletions } = computeLcsDiffCounts(currentLines, targetLines);
      if (additions > 0 || deletions > 0) {
        result.push({
          fileUri: tracker.fileUri,
          fileName: tracker.fileName,
          ext: tracker.ext,
          additions,
          deletions,
          isCreated: false,
        });
      }
      continue;
    }

    // 2. If target was before the first snapshot, but file was modified in undone range:
    if (!historyBeforeTarget && tracker.history.length > 0 && !tracker.isExplicitlyCreated) {
      const firstHistory = tracker.history[0];
      if (firstHistory && latestHistory && firstHistory.content && latestHistory.content) {
        const targetLines = firstHistory.content.split("\n");
        const currentLines = latestHistory.content.split("\n");
        const { additions, deletions } = computeLcsDiffCounts(currentLines, targetLines);
        if (additions > 0 || deletions > 0) {
          result.push({
            fileUri: tracker.fileUri,
            fileName: tracker.fileName,
            ext: tracker.ext,
            additions,
            deletions,
            isCreated: false,
          });
        }
        continue;
      }
    }

    // 3. If the file was genuinely created in undone range and never existed before:
    const hasPriorExistence =
      Boolean(historyBeforeTarget) ||
      tracker.hunkDiffs.some((hd) => hd.stepIndex <= targetStepIndex);

    if (tracker.isExplicitlyCreated && !hasPriorExistence) {
      result.push({
        fileUri: tracker.fileUri,
        fileName: tracker.fileName,
        ext: tracker.ext,
        additions: 0,
        deletions: 0,
        isCreated: true,
      });
      continue;
    }

    // 4. Fallback for files modified ONLY via codeAction:
    // Only count steps that strictly occurred AFTER targetStepIndex
    const relevantHunks = tracker.hunkDiffs.filter((hd) => hd.stepIndex > targetStepIndex);
    if (relevantHunks.length > 0) {
      let adds = 0;
      let dels = 0;
      for (const hd of relevantHunks) {
        adds += hd.adds;
        dels += hd.dels;
      }

      if (dels > 0 || adds > 0) {
        result.push({
          fileUri: tracker.fileUri,
          fileName: tracker.fileName,
          ext: tracker.ext,
          additions: dels,
          deletions: adds,
          isCreated: false,
        });
      }
    }
  }

  // Filter out any 0-diff / empty items
  return result.filter(
    (item) => item.isCreated || item.additions > 0 || item.deletions > 0,
  );
}
