import type { ChatMessage, ToolCallData, TrajectoryStep } from "../types";
import { getAskQuestionRequest, getFilePermissionRequest } from "../utils/stepCards";
import {
  isSubagentToolName,
  subagentDataFromStep,
} from "../utils/subagents";

export function stripInternalDirectives(text: string): string {
  return text
    .replace(/<user_safety_directive[\s\S]*?<\/user_safety_directive>\s*/gi, "")
    .replace(/\[System (?:Safety )?Directive:[^\]]*\]\s*/gi, "")
    .replace(/^改文件前先问我：[^\n]*\n+/gim, "")
    .replace(/^编辑前先出计划：[^\n]*\n+/gim, "")
    .trim();
}

function textFromItems(items?: { text?: string }[]): string {
  if (!items) return "";
  const raw = items
    .filter((item) => item.text?.trim())
    .map((item) => item.text!.trim())
    .join("\n\n");
  return stripInternalDirectives(raw);
}

function cleanUriPath(uri?: string): { name: string; dir: string; ext: string } {
  if (!uri) return { name: "", dir: "", ext: "" };
  let decoded = "";
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    decoded = uri;
  }
  const clean = decoded.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
  const name = clean.split("/").pop() ?? clean;
  const dir = clean.substring(0, clean.length - name.length);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return { name, dir, ext };
}

/**
 * Cache keyed by a content fingerprint, NOT array identity.
 *
 * Why not WeakMap? `useStepsStream` calls `setSteps([...stepsRef.current])` which creates
 * a brand-new array reference on every flush, making WeakMap<TrajectoryStep[], ...> always miss.
 * A content fingerprint (baseOffset + length + boundary step content) is stable across shallow copies.
 */
const stepsToMessagesCache = new Map<string, ChatMessage[]>();
const MAX_STM_CACHE = 20;

/** Extract a short stable fingerprint from a single step for use in cache keys. */
function stepToken(step: TrajectoryStep | undefined): string {
  if (!step) return "_";
  const s = step as any;
  // Prefer an explicit stable ID — zero cost
  if (s.clientMessageId) return `cid:${s.clientMessageId}`;
  // JSON snapshot of the full step capped at 120 chars.
  // This is safe: steps are plain objects, JSON.stringify is O(n) on their size,
  // and individual steps are typically small (< 1 KB).
  try {
    return JSON.stringify(step).slice(0, 120);
  } catch {
    return step.type ?? "_";
  }
}

function makeStepsFingerprint(steps: TrajectoryStep[], baseOffset: number): string {
  return `${baseOffset}:${steps.length}:${stepToken(steps[0])}:${stepToken(steps[steps.length - 1])}`;
}

function extractMediaFromUserStep(step: TrajectoryStep): unknown[] | undefined {
  const stepAny = step as any;
  const userPrompt =
    step.userInput ||
    stepAny.userPrompt ||
    stepAny.user_input ||
    stepAny.input;

  const directMedia = Array.isArray(userPrompt?.media)
    ? userPrompt.media
    : userPrompt?.media
      ? [userPrompt.media]
      : [];
  const stepMedia = Array.isArray(stepAny.media)
    ? stepAny.media
    : stepAny.media
      ? [stepAny.media]
      : [];
  const attachments = Array.isArray(userPrompt?.attachments)
    ? userPrompt.attachments
    : userPrompt?.attachments
      ? [userPrompt.attachments]
      : [];
  const images = Array.isArray(userPrompt?.images)
    ? userPrompt.images
    : userPrompt?.images
      ? [userPrompt.images]
      : [];

  const itemMedia = (userPrompt?.items || []).flatMap((it: any) => {
    if (!it || typeof it !== "object") return [];
    if (it.media) return Array.isArray(it.media) ? it.media : [it.media];
    if (it.image) return Array.isArray(it.image) ? it.image : [it.image];
    if (it.inlineData || it.inline_data || it.data) return [it];
    if (
      it.payload &&
      (it.payload.case === "inlineData" ||
        it.payload.inlineData ||
        it.payload.inline_data ||
        it.payload.data)
    ) {
      return [it];
    }
    return [];
  });

  const all = [
    ...directMedia,
    ...stepMedia,
    ...attachments,
    ...images,
    ...itemMedia,
  ].filter(Boolean);

  return all.length > 0 ? all : undefined;
}

/** Extract displayable messages from raw trajectory steps.
 * @param baseOffset Absolute offset of steps[0] in the full trajectory.
 *   Pass 0 (default) if you always load from the beginning.
 *   Required for correct revert stepIndex when using paginated lazy loading.
 */
export function stepsToMessages(steps: TrajectoryStep[], baseOffset = 0): ChatMessage[] {
  if (steps.length === 0) return [];
  // Build a fingerprint-based cache key — survives array spread copies
  const cacheKey = makeStepsFingerprint(steps, baseOffset);
  if (stepsToMessagesCache.has(cacheKey)) {
    return stepsToMessagesCache.get(cacheKey)!;
  }

  const messages: ChatMessage[] = [];
  const pendingInvokeToolCalls: ToolCallData[] = [];

  let currentTurnIsBtw = false;

  for (let i = 0; i < steps.length; i++) {
    const absoluteIndex = baseOffset + i;
    const step = steps[i];
    const type = step.type;

    const userPrompt =
      step.userInput ||
      (step as any).userPrompt ||
      (step as any).user_input ||
      (step as any).input;
    const isUserStep =
      type === "CORTEX_STEP_TYPE_USER_INPUT" ||
      type === "USER_INPUT" ||
      Boolean(userPrompt);

    if (isUserStep && userPrompt) {
      const text = stripInternalDirectives(
        textFromItems(userPrompt.items) || userPrompt.text || "",
      );
      // Filter out /btw side questions from polluting the main task conversation
      if (text.trim().startsWith("/btw")) {
        currentTurnIsBtw = true;
        continue;
      }
      currentTurnIsBtw = false;
      const media = extractMediaFromUserStep(step);
      if (text || (media && media.length > 0)) {
        messages.push({
          role: "user",
          content: text,
          stepIndex: absoluteIndex,
          type: "CORTEX_STEP_TYPE_USER_INPUT",
          optimisticId: step.clientMessageId,
          media,
          step,
        });
      }
      continue;
    }

    // If current turn is a /btw side question, suppress all subsequent steps in this turn from main chat
    if (currentTurnIsBtw) {
      continue;
    }

    // Older AG trajectories put invoke_subagent arguments on the planner
    // response, followed by a payloadless native invocation marker.
    if (type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
      pendingInvokeToolCalls.length = 0;
      for (const toolCall of step.plannerResponse?.toolCalls ?? []) {
        if (toolCall.name === "invoke_subagent") {
          pendingInvokeToolCalls.push(toolCall);
        }
      }
    }

    // Ask Question (including URL / MCP permission choice prompts) must take precedence when options exist!
    const askQuestion = getAskQuestionRequest(step);
    if (askQuestion) {
      messages.push({
        role: "system",
        content: "",
        stepIndex: absoluteIndex,
        type: "CORTEX_STEP_TYPE_ASK_QUESTION",
        step,
      });
      continue;
    }

    // File permission request: emit as a dedicated message type
    const fpr = getFilePermissionRequest(step);
    if (fpr) {
      messages.push({
        role: "system",
        content: "",
        stepIndex: absoluteIndex,
        type: "CORTEX_STEP_TYPE_FILE_PERMISSION",
        step,
      });
      continue;
    }

    // Handle error steps
    const stepRecord = step as unknown as Record<string, unknown>;
    const isErrorStep =
      type === "CORTEX_STEP_TYPE_ERROR" ||
      type.includes("ERROR") ||
      step.status === "CORTEX_STEP_STATUS_ERROR" ||
      step.status === "CASCADE_RUN_STATUS_ERROR" ||
      Boolean(stepRecord.error) ||
      Boolean(stepRecord.errorMessage);

    if (isErrorStep) {
      const errObj = stepRecord.error;
      let rawText = "";
      if (typeof errObj === "string") {
        rawText = errObj;
      } else if (typeof errObj === "object" && errObj !== null) {
        const eo = errObj as Record<string, unknown>;
        const candidate =
          eo.userErrorMessage ||
          eo.shortError ||
          eo.errorMessage ||
          eo.message ||
          eo.details ||
          eo.description ||
          eo.modelErrorMessage;
        rawText = String(candidate || JSON.stringify(errObj));
      } else if (typeof stepRecord.errorMessage === "string") {
        rawText = stepRecord.errorMessage;
      } else if (typeof stepRecord.errorMessage === "object" && stepRecord.errorMessage !== null) {
        const eo = stepRecord.errorMessage as Record<string, unknown>;
        const candidate =
          eo.userErrorMessage ||
          eo.shortError ||
          eo.errorMessage ||
          eo.message ||
          eo.details ||
          eo.description;
        rawText = String(candidate || JSON.stringify(stepRecord.errorMessage));
      } else if (step.plannerResponse?.modifiedResponse) {
        rawText = step.plannerResponse.modifiedResponse;
      }

      if (rawText && rawText !== "[object Object]") {
        // Prevent consecutive identical error messages
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && (lastMsg.type === "error" || lastMsg.icon === "alert") && lastMsg.content === rawText) {
          continue;
        }
        messages.push({
          role: "system",
          content: String(rawText),
          stepIndex: absoluteIndex,
          type: "error",
          icon: "alert",
          step,
        });
        continue;
      }
    }

    const toolName = step.metadata?.toolCall?.name;

    // Filter internal manage_subagents list query noise from main chat cards
    if (toolName === "manage_subagents") {
      let argsObj: any;
      try {
        argsObj = JSON.parse(step.metadata?.toolCall?.argumentsJson || "{}");
      } catch {}
      const action = (argsObj?.Action || argsObj?.action || "").toLowerCase();
      if (action === "list" || !action) {
        continue;
      }
    }

    const isNativeSubagent =
      type === "CORTEX_STEP_TYPE_INVOKE_SUBAGENT" ||
      type === "CORTEX_STEP_TYPE_SUBAGENT";
    const isSubagent = isSubagentToolName(toolName) || isNativeSubagent;

    if (isSubagent) {
      const fallbackToolCall = isNativeSubagent
        ? pendingInvokeToolCalls.shift()
        : undefined;
      if (!isNativeSubagent && toolName === "invoke_subagent") {
        pendingInvokeToolCalls.shift();
      }
      const subagent = subagentDataFromStep(step, fallbackToolCall);
      messages.push({
        role: "system",
        content: "",
        stepIndex: absoluteIndex,
        type: "CORTEX_STEP_TYPE_SUBAGENT",
        step,
        subagent,
      });
      continue;
    }

    if (type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
      const pr = step.plannerResponse;
      if (!pr) continue;

      const itemText = textFromItems(pr.items);
      const text = pr.modifiedResponse?.trim() ? pr.modifiedResponse : itemText;
      const thinking = pr.thinking ?? "";
      const thinkingDuration = pr.thinkingDuration ?? "";

      if (text.trim() || thinking.trim()) {
        messages.push({
          role: "assistant",
          content: text,
          stepIndex: absoluteIndex,
          type,
          thinking: thinking || undefined,
          thinkingDuration: thinkingDuration || undefined,
          step,
        });
      }
    } else if (type === "CORTEX_STEP_TYPE_RUN_COMMAND" && step.runCommand) {
      const cmd =
        step.runCommand.commandLine ??
        step.runCommand.command ??
        step.runCommand.proposedCommandLine ??
        "";
      if (cmd) {
        messages.push({
          role: "system",
          content: "",
          stepIndex: absoluteIndex,
          type,
          step,
        });
      }
    } else if (type === "CORTEX_STEP_TYPE_CODE_ACTION" && step.codeAction) {
      const ca = step.codeAction;
      const fileUri = ca.actionResult?.edit?.absoluteUri ?? "";
      const lastMsg = messages[messages.length - 1];

      if (
        fileUri &&
        lastMsg &&
        lastMsg.type === "CORTEX_STEP_TYPE_CODE_ACTION" &&
        lastMsg.step?.codeAction?.actionResult?.edit?.absoluteUri === fileUri
      ) {
        const lastEdit = lastMsg.step.codeAction.actionResult?.edit;
        const newLines = ca.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];
        if (lastEdit?.diff?.unifiedDiff && newLines.length > 0) {
          lastEdit.diff.unifiedDiff.lines = [
            ...(lastEdit.diff.unifiedDiff.lines ?? []),
            ...newLines,
          ];
        }
        continue;
      }

      messages.push({
        role: "system",
        content: "",
        stepIndex: absoluteIndex,
        type,
        step,
      });
    } else if (
      type === "CORTEX_STEP_TYPE_COMMAND_STATUS" &&
      step.commandStatus
    ) {
      const cs = step.commandStatus;
      const cmdId = cs.commandId;
      const status = cs.status;
      const combined = cs.combined ?? "";
      for (let j = messages.length - 1; j >= 0; j--) {
        const m = messages[j];
        if (m.step?.runCommand && m.step.runCommand.commandId === cmdId) {
          if (status === "CORTEX_STEP_STATUS_DONE" && combined) {
            m.step.runCommand.combinedOutput = { full: combined };
          }
          break;
        }
      }
    } else if (
      type === "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT" &&
      step.sendCommandInput
    ) {
      if (step.sendCommandInput.terminate) {
        messages.push({
          role: "system",
          content: `Sending termination to command`,
          stepIndex: absoluteIndex,
          type,
        });
      }
    } else if (type === "CORTEX_STEP_TYPE_GREP_SEARCH" && step.grepSearch) {
      const gs = step.grepSearch;
      const query = gs.query ?? "";
      const results = gs.results ?? [];
      const { name: pathLabel, dir } = cleanUriPath(gs.searchPathUri);
      const displayLabel = pathLabel || dir.replace(/\/$/, "").split("/").pop() || "工作区";
      messages.push({
        role: "system",
        content: `Searched \`${query}\` in **${displayLabel}** · ${results.length} result${results.length !== 1 ? "s" : ""}`,
        stepIndex: absoluteIndex,
        type,
        icon: "search",
        explorationGroup: {
          title: "探索 · 1 项操作",
          totalCount: 1,
          items: [
            {
              action: "已搜索",
              name: `"${query}"`,
              path: `${displayLabel} · ${results.length} 个结果`,
              ext: "search",
            },
          ],
        },
      });
    } else if (type === "CORTEX_STEP_TYPE_VIEW_FILE" && step.viewFile) {
      const vf = step.viewFile;
      const { name, dir, ext } = cleanUriPath(vf.absolutePathUri);
      const range =
        vf.startLine && vf.endLine ? ` #L${vf.startLine}-${vf.endLine}` : "";
      messages.push({
        role: "system",
        content: `Viewed **${name}**${range}`,
        stepIndex: absoluteIndex,
        type,
        icon: "eye",
        explorationGroup: {
          title: "探索 · 1 文件",
          totalCount: 1,
          items: [
            {
              action: "已读取",
              name,
              path: dir,
              ext,
              range: range.trim() || undefined,
            },
          ],
        },
      });
    } else if (
      type === "CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE" &&
      step.viewFileOutline
    ) {
      const { name, dir, ext } = cleanUriPath(step.viewFileOutline.absolutePathUri);
      messages.push({
        role: "system",
        content: `Outlined **${name}**`,
        stepIndex: absoluteIndex,
        type,
        icon: "list",
        explorationGroup: {
          title: "探索 · 1 文件",
          totalCount: 1,
          items: [
            {
              action: "已分析",
              name,
              path: dir,
              ext,
            },
          ],
        },
      });
    } else if (
      type === "CORTEX_STEP_TYPE_VIEW_CODE_ITEM" &&
      step.viewCodeItem
    ) {
      const vci = step.viewCodeItem;
      const { name, dir, ext } = cleanUriPath(vci.absoluteUri);
      const nodes = vci.nodePaths ?? [];
      messages.push({
        role: "system",
        content: `Analyzed **${name}**${nodes.length ? ` · ${nodes.join(", ")}` : ""}`,
        stepIndex: absoluteIndex,
        type,
        icon: "file-search",
        explorationGroup: {
          title: "探索 · 1 文件",
          totalCount: 1,
          items: [
            {
              action: "已分析",
              name,
              path: `${dir}${nodes.length ? ` (${nodes.join(", ")})` : ""}`,
              ext,
            },
          ],
        },
      });
    } else if (
      type === "CORTEX_STEP_TYPE_LIST_DIRECTORY" &&
      step.listDirectory
    ) {
      const ld = step.listDirectory;
      const { name, dir } = cleanUriPath(ld.directoryPathUri);
      const results = ld.results ?? [];
      messages.push({
        role: "system",
        content: `Listed **${name || "root"}/** · ${results.length} items`,
        stepIndex: absoluteIndex,
        type,
        icon: "folder",
        explorationGroup: {
          title: "探索 · 1 列表",
          totalCount: 1,
          items: [
            {
              action: "已列出",
              name: `${name || "目录"}/`,
              path: `${dir} · ${results.length} 个文件`,
              ext: "folder",
            },
          ],
        },
      });
    } else if (type === "CORTEX_STEP_TYPE_FIND" && step.find) {
      const f = step.find;
      const pattern = f.pattern ?? "*";
      const results = f.results ?? [];
      messages.push({
        role: "system",
        content: `Find \`${pattern}\` · ${results.length} result${results.length !== 1 ? "s" : ""}`,
        stepIndex: absoluteIndex,
        type,
        icon: "search",
        explorationGroup: {
          title: "探索 · 1 项操作",
          totalCount: 1,
          items: [
            {
              action: "已查找",
              name: `"${pattern}"`,
              path: `${results.length} 个匹配`,
              ext: "search",
            },
          ],
        },
      });
    } else if (
      type === "CORTEX_STEP_TYPE_CALL_MCP_TOOL" ||
      type.includes("MCP") ||
      Boolean((step as any).callMcpTool)
    ) {
      const mcpData = (step as any).callMcpTool ?? (step as any).mcpTool;
      const server = mcpData?.serverName ?? (step.metadata?.toolCall as any)?.serverName ?? "MCP";
      const tool = mcpData?.toolName ?? step.metadata?.toolCall?.name ?? "tool";
      messages.push({
        role: "system",
        content: `执行 MCP 工具 **${server}/${tool}**`,
        stepIndex: absoluteIndex,
        type,
        icon: "box",
      });
    } else if (
      type === "CORTEX_STEP_TYPE_REVERT" ||
      type.includes("REVERT") ||
      Boolean((step as any).revert)
    ) {
      const stepIdx = (step as any).revert?.stepIndex ?? step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      messages.push({
        role: "system",
        content: `会话已回退至步骤 #${stepIdx !== undefined ? Number(stepIdx) + 1 : i + 1}`,
        stepIndex: absoluteIndex,
        type,
        icon: "corner-up-left",
      });
    }
  }

  // Collapse consecutive text-only / exploration system messages
  const collapsed: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system" && !msg.step) {
      const prev = collapsed[collapsed.length - 1];
      if (prev?.role === "system" && !prev.step) {
        prev.content += "\n" + msg.content;
        if (prev.explorationGroup && msg.explorationGroup) {
          prev.explorationGroup.items.push(...msg.explorationGroup.items);
          prev.explorationGroup.totalCount = prev.explorationGroup.items.length;
          prev.explorationGroup.title = `探索 · ${prev.explorationGroup.totalCount} 文件`;
        } else if (msg.explorationGroup) {
          prev.explorationGroup = { ...msg.explorationGroup };
        }
        continue;
      }
    }
    collapsed.push({ ...msg });
  }

  // Cache against content fingerprint (survives setSteps([...stepsRef.current]) spread copies)
  if (stepsToMessagesCache.size >= MAX_STM_CACHE) {
    // Evict oldest entry to prevent unbounded memory growth
    const firstKey = stepsToMessagesCache.keys().next().value;
    if (firstKey) stepsToMessagesCache.delete(firstKey);
  }
  stepsToMessagesCache.set(cacheKey, collapsed);
  return collapsed;
}
