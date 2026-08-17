import { useState, useMemo, useCallback } from "react";
import type { TrajectoryStep } from "../types";
import { cleanPath } from "../utils/pathUtils";

export interface SubagentArtifactItem {
  type: "file" | "symbol";
  label: string;
  path?: string;
  ext?: string;
}

export interface SubagentWorkStep {
  id: string;
  type: string;
  title: string;
  detail?: string;
  status: "done" | "running" | "error";
  duration?: string;
}

export interface SubagentSession {
  id: string;
  stepIndex: number;
  role: string;
  typeName: string;
  model?: string;
  prompt: string;
  duration?: string | number;
  status: "running" | "completed" | "failed";
  output?: string;
  workSteps?: SubagentWorkStep[];
  rawSteps?: TrajectoryStep[];
  conversationId?: string;
  artifacts?: SubagentArtifactItem[];
  diffSummary?: {
    filesCount: number;
    additions: number;
    deletions: number;
  };
  timestamp?: string;
}

export function extractSubagentSessions(steps: TrajectoryStep[] = []): SubagentSession[] {
  const sessions: SubagentSession[] = [];
  const seenIds = new Set<string>();

  // Suffix-existence arrays computed once (O(n)) so the per-step lookups below
  // don't rescan the whole trajectory (previously O(n²) on long conversations).
  // suffixUserInput[i]: any user input exists at or after step i.
  // suffixActivity[i]: any SYSTEM_MESSAGE / RUN_COMMAND / CODE_ACTION /
  //   PLANNER_RESPONSE step exists at or after step i.
  const n = steps.length;
  const suffixUserInput = new Array<boolean>(n + 1).fill(false);
  const suffixActivity = new Array<boolean>(n + 1).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    const s = steps[i];
    const typeStr = String(s.type || "");
    suffixUserInput[i] =
      suffixUserInput[i + 1] ||
      s.type === "USER_INPUT" ||
      s.type === "CORTEX_STEP_TYPE_USER_INPUT" ||
      typeStr.includes("USER_INPUT") ||
      (s as any).source === "USER_EXPLICIT";
    suffixActivity[i] =
      suffixActivity[i + 1] ||
      typeStr.includes("SYSTEM_MESSAGE") ||
      typeStr.includes("RUN_COMMAND") ||
      typeStr.includes("CODE_ACTION") ||
      typeStr.includes("PLANNER_RESPONSE");
  }

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const prToolCalls = (step as any).plannerResponse?.toolCalls || (step as any).plannerResponse?.tool_calls || [];
    const stepToolCalls = (step as any).toolCalls || (step as any).tool_calls;
    const rawToolCalls: any[] = Array.isArray(stepToolCalls) && stepToolCalls.length > 0
      ? stepToolCalls
      : Array.isArray(prToolCalls) && prToolCalls.length > 0
        ? prToolCalls
        : step.metadata?.toolCall
          ? [step.metadata.toolCall]
          : (step as any).toolCall
            ? [(step as any).toolCall]
            : [];

    const prevStep = idx > 0 ? steps[idx - 1] : undefined;
    const prevHadInvoke = Boolean(
      prevStep && (
        (prevStep as any).plannerResponse?.toolCalls?.some((t: any) => t.name === "invoke_subagent") ||
        (prevStep as any).tool_calls?.some((t: any) => t.name === "invoke_subagent") ||
        (prevStep as any).toolCalls?.some((t: any) => t.name === "invoke_subagent") ||
        (prevStep as any).metadata?.toolCall?.name === "invoke_subagent"
      )
    );

    const isNativeInvoke =
      Boolean(step.invokeSubagent) ||
      ((step.type === "CORTEX_STEP_TYPE_INVOKE_SUBAGENT" ||
        step.type === "CORTEX_STEP_TYPE_SUBAGENT" ||
        step.type === "INVOKE_SUBAGENT") && !prevHadInvoke);

    // If no tool_calls array but it's a standalone native invoke step with explicit subagent payload
    if (rawToolCalls.length === 0 && isNativeInvoke) {
      rawToolCalls.push({ name: "invoke_subagent", args: {} });
    }

    for (const toolCall of rawToolCalls) {
      const toolName = toolCall?.name || "";

      if (
        toolName === "invoke_subagent" ||
        toolName === "CORTEX_STEP_TYPE_INVOKE_SUBAGENT" ||
        toolName.endsWith("invoke_subagent") ||
        isNativeInvoke
      ) {
        let args: any = toolCall?.args;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {}
        }
        if (!args && toolCall?.argumentsJson) {
          try {
            args = JSON.parse(toolCall.argumentsJson);
          } catch {}
        }

        let parsedSubagents = args?.Subagents || args?.subagents;
        if (typeof parsedSubagents === "string") {
          try {
            parsedSubagents = JSON.parse(parsedSubagents);
          } catch {}
        }

        const nativeSubagents = (step.invokeSubagent as any)?.subagents ?? [];
        const argSubagents = Array.isArray(parsedSubagents)
          ? parsedSubagents
          : [];

        const rawItems = nativeSubagents.length > 0
          ? nativeSubagents
          : argSubagents.length > 0
            ? argSubagents
            : [
                {
                  Role: (step.invokeSubagent as any)?.subagentName || args?.SubagentName || args?.Role || args?.role || "subagent",
                  TypeName: (step.invokeSubagent as any)?.typeName || args?.TypeName || args?.typeName || "subagent",
                  Prompt: (step.invokeSubagent as any)?.prompt || (step.invokeSubagent as any)?.initialPrompt || args?.Prompt || args?.prompt || args?.InitialPrompt || args?.initialPrompt || "",
                  Model: (step.invokeSubagent as any)?.model || args?.Model || args?.model || args?.ModelTier || args?.modelTier,
                },
              ];

        // Look for conversationId in the current or next steps
        let convId =
          (step.metadata as any)?.childConversationId ||
          (step as any).conversationId ||
          (step.metadata as any)?.conversationId ||
          (step.invokeSubagent as any)?.conversationId ||
          args?.ConversationId ||
          args?.conversationId;

        if (!convId) {
          for (let k = idx; k < Math.min(steps.length, idx + 5); k++) {
            const s = steps[k];
            const sStr =
              typeof (s as any)?.content === "string"
                ? (s as any).content
                : (s as any)?.plannerResponse?.text || JSON.stringify(s);
            const m = sStr.match(/"conversationId":\s*"([^"]+)"/);
            if (m) {
              convId = m[1];
              break;
            }
          }
        }

        let isDone = false;
        let isError = false;
        if (convId) {
          // Scan forward within this turn for the subagent's report-back.
          // Subagent reports arrive in the turn that spawned them, so stop at
          // the next user input — this also bounds the scan on long traces.
          for (let j = idx + 1; j < steps.length; j++) {
            const nextStep = steps[j];
            if (
              nextStep.type === "USER_INPUT" ||
              nextStep.type === "CORTEX_STEP_TYPE_USER_INPUT" ||
              (nextStep as any).source === "USER_EXPLICIT"
            ) {
              break;
            }
            const isSystemMsg =
              nextStep.type === "SYSTEM_MESSAGE" ||
              nextStep.type === "CORTEX_STEP_TYPE_SYSTEM_MESSAGE" ||
              String(nextStep.type || "").includes("SYSTEM") ||
              (nextStep as any).source === "SYSTEM";

            const str =
              typeof (nextStep as any).content === "string"
                ? (nextStep as any).content
                : (nextStep as any)?.plannerResponse?.text || JSON.stringify(nextStep);

            if (isSystemMsg) {
              if (
                str.includes("sender=" + convId) ||
                str.includes('"sender":"' + convId + '"') ||
                str.includes(`sender=${convId}`) ||
                (str.includes(convId) && (str.includes("cancel") || str.includes("complete") || str.includes("result") || str.includes("finished")))
              ) {
                isDone = true;
                if (
                  str.includes("failed with result") ||
                  str.includes("errored") ||
                  str.includes("cancel") ||
                  nextStep.status === "ERROR" ||
                  nextStep.status === "CORTEX_STEP_STATUS_ERROR"
                ) {
                  isError = true;
                }
                break;
              }
            } else if (
              str.includes("sender=" + convId) ||
              str.includes('"sender":"' + convId + '"') ||
              str.includes(`sender=${convId}`)
            ) {
              isDone = true;
              break;
            }
          }
        }

        // If a subsequent user request or subsequent subagent invocation occurred, previous subagent turn is done
        if (suffixUserInput[idx + 1]) {
          isDone = true;
        }

        // If subsequent planner/tool steps executed after invocation and system report
        if (steps.length > idx + 2 && !isDone && suffixActivity[idx + 1]) {
          isDone = true;
        }

        // Determine status: if conversationId is tracked and hasn't reported back, it is running!
        let stepStatus: "running" | "completed" | "failed" = "completed";
        if (convId) {
          if (!isDone) {
            stepStatus = "running";
          } else if (isError) {
            stepStatus = "failed";
          } else {
            stepStatus = "completed";
          }
        } else {
          if (step.status === "ERROR" || step.errorMessage || (step as any).isError || step.status === "CORTEX_STEP_STATUS_ERROR") {
            stepStatus = "failed";
          } else if (step.status === "RUNNING" || step.status === "WAITING" || step.status === "CORTEX_STEP_STATUS_RUNNING") {
            stepStatus = "running";
          } else {
            stepStatus = "completed";
          }
        }

        // Forward scan through subsequent steps in this turn to aggregate work steps, full output, files and diffs
        const outputParts: string[] = [];
        if ((step.plannerResponse as any)?.message) {
          outputParts.push((step.plannerResponse as any).message);
        } else if ((step.metadata as any)?.output) {
          outputParts.push(String((step.metadata as any).output));
        } else if ((step as any).output) {
          outputParts.push(String((step as any).output));
        }

        const touchedFiles = new Set<string>();
        const touchedSymbols = new Set<string>();
        const workSteps: SubagentWorkStep[] = [];
        const rawSteps: TrajectoryStep[] = [step];
        let totalAdditions = 0;
        let totalDeletions = 0;

        // Add initial invocation step
        workSteps.push({
          id: `step-inv-${idx}`,
          type: "invoke",
          title: "启动子智能体并分配任务",
          detail: rawItems[0]?.Role ? `角色: ${rawItems[0].Role}` : "初始任务分发",
          status: "done",
        });

        for (let fIdx = idx + 1; fIdx < steps.length; fIdx++) {
          const nextStep = steps[fIdx];
          if (
            nextStep.type === "USER_INPUT" ||
            nextStep.type === "CORTEX_STEP_TYPE_USER_INPUT" ||
            (nextStep as any).source === "USER_EXPLICIT"
          ) {
            break;
          }

          // If another subagent is invoked later, stop
          const nToolCall = nextStep.metadata?.toolCall || (nextStep as any).toolCall;
          const nIsNative = nextStep.type === "CORTEX_STEP_TYPE_INVOKE_SUBAGENT" || nextStep.type === "CORTEX_STEP_TYPE_SUBAGENT";
          const nName = nToolCall?.name || (nIsNative ? "invoke_subagent" : "");
          if ((nName.includes("invoke_subagent") || nIsNative) && fIdx > idx + 1) {
            break;
          }

          rawSteps.push(nextStep);

          // Collect message / response content
          const msg = (nextStep.plannerResponse as any)?.message || (nextStep as any).content || "";
          if (msg && !outputParts.includes(msg)) {
            outputParts.push(msg);
          }

          // Parse tool steps & file changes
          let sTitle = "";
          let sDetail = "";
          let sType = "tool";
          const sStatus: SubagentWorkStep["status"] =
            nextStep.status === "ERROR" || nextStep.errorMessage ? "error" : "done";

          if (nextStep.viewFile || nName === "view_file" || nName === "read_file") {
            sType = "view_file";
            sTitle = "读取文件";
            const p = cleanPath(nextStep.viewFile?.absolutePathUri || (nToolCall?.args as any)?.AbsolutePath || (nToolCall?.args as any)?.path);
            sDetail = p;
            if (p) touchedFiles.add(p);
          } else if (nextStep.grepSearch || nName === "grep_search" || nName === "search") {
            sType = "grep";
            sTitle = "检索代码";
            sDetail = nextStep.grepSearch?.query || (nToolCall?.args as any)?.Query || "关键字搜索";
          } else if (nextStep.runCommand || nName === "run_command" || nName === "execute_command") {
            sType = "command";
            sTitle = "执行命令";
            sDetail = nextStep.runCommand?.commandLine || (nToolCall?.args as any)?.CommandLine || "shell command";
          } else if (nextStep.replaceFileContent || nName === "replace_file_content" || nName === "write_to_file") {
            sType = "edit";
            sTitle = "修改文件";
            const p = cleanPath(nextStep.replaceFileContent?.targetFile || (nextStep.replaceFileContent as any)?.absolutePathUri || (nToolCall?.args as any)?.TargetFile);
            sDetail = p;
            if (p) touchedFiles.add(p);
          } else if (nextStep.listDirectory || nName === "list_dir") {
            sType = "list_dir";
            sTitle = "探索工作区目录";
            sDetail = cleanPath(nextStep.listDirectory?.directoryPathUri || (nToolCall?.args as any)?.DirectoryPath);
          } else if (nToolCall) {
            sType = "tool";
            sTitle = `调用工具 ${nName}`;
            sDetail = nToolCall.summary || "";
          }

          if (sTitle) {
            workSteps.push({
              id: `step-${fIdx}`,
              type: sType,
              title: sTitle,
              detail: sDetail,
              status: sStatus,
            });
          }

          // Calculate diff lines
          if (nToolCall) {
            let tArgs = nToolCall.args;
            if (!tArgs && nToolCall.argumentsJson) {
              try {
                tArgs = JSON.parse(nToolCall.argumentsJson);
              } catch {}
            }
            if (tArgs) {
              if (tArgs.ReplacementChunks && Array.isArray(tArgs.ReplacementChunks)) {
                for (const chunk of tArgs.ReplacementChunks) {
                  const addLines = (chunk.ReplacementContent || "").split("\n").length;
                  const delLines = (chunk.TargetContent || "").split("\n").length;
                  totalAdditions += addLines;
                  totalDeletions += delLines;
                }
              } else if (tArgs.ReplacementContent) {
                const addLines = (tArgs.ReplacementContent || "").split("\n").length;
                const delLines = (tArgs.TargetContent || "").split("\n").length;
                totalAdditions += addLines;
                totalDeletions += delLines;
              }
            }
          }
        }

        let output = outputParts.filter(Boolean).join("\n\n").trim();

        // Extract backticked files & symbols from output text
        if (output) {
          const matches = output.matchAll(/`([^`\n\r]+)`/g);
          for (const m of matches) {
            const val = m[1].trim();
            if (val.includes("/") || val.includes("\\") || /\.(ts|tsx|js|jsx|json|css|html|md|py|go|rs|prisma)$/i.test(val)) {
              touchedFiles.add(cleanPath(val));
            } else if (/^[a-zA-Z_][a-zA-Z0-9_]{3,}$/.test(val) && !/^(true|false|null|const|function|import|export|return)$/.test(val)) {
              if (touchedSymbols.size < 8) {
                touchedSymbols.add(val);
              }
            }
          }
        }

        const artifacts: SubagentArtifactItem[] = [];
        touchedFiles.forEach((file) => {
          const ext = file.split(".").pop() || "";
          artifacts.push({ type: "file", label: file, path: file, ext });
        });
        touchedSymbols.forEach((sym) => {
          artifacts.push({ type: "symbol", label: sym });
        });

        // Parse diff summary lines like "2 files changed +912 -50"
        const diffMatch =
          output.match(/(\d+)\s+files?\s+changed(?:,\s*|\s+)\+(\d+)(?:,\s*|\s+)-(\d+)/i) ||
          output.match(/(\d+)\s+files?\s+changed/i);
        let diffSummary: SubagentSession["diffSummary"] = undefined;
        if (diffMatch) {
          diffSummary = {
            filesCount: parseInt(diffMatch[1], 10),
            additions: diffMatch[2] ? parseInt(diffMatch[2], 10) : totalAdditions,
            deletions: diffMatch[3] ? parseInt(diffMatch[3], 10) : totalDeletions,
          };
        } else if (touchedFiles.size > 0 && (totalAdditions > 0 || totalDeletions > 0)) {
          diffSummary = {
            filesCount: touchedFiles.size,
            additions: totalAdditions,
            deletions: totalDeletions,
          };
        }

        for (let sIdx = 0; sIdx < rawItems.length; sIdx++) {
          const item = rawItems[sIdx];
          const role = String(item.Role || item.role || item.subagentName || `subagent-${sIdx + 1}`).trim();
          const typeName = String(item.TypeName || item.typeName || "subagent").trim();
          const model = item.Model || item.model || item.ModelTier || item.modelTier || undefined;
          const prompt = String(item.Prompt || item.prompt || item.initialPrompt || item.instructions || "").trim();

          // Link child conversation if role matches
          const childConversationId =
            convId ||
            (step.metadata as any)?.childConversationId ||
            (step as any).conversationId ||
            (step.metadata as any)?.conversationId ||
            args?.ConversationId ||
            args?.conversationId;

          // Check if this subagent session was already created (e.g. planner response vs tool execution step)
          const existing = sessions.find((s) => {
            const sameRole = s.role.toLowerCase() === role.toLowerCase();
            if (!sameRole) return false;

            if (childConversationId && s.conversationId && s.conversationId === childConversationId) {
              return true;
            }
            if (!s.prompt || !prompt || s.prompt === prompt || s.prompt.startsWith(prompt.slice(0, 50)) || prompt.startsWith(s.prompt.slice(0, 50))) {
              if (Math.abs(s.stepIndex - idx) <= 6) {
                return true;
              }
            }
            return false;
          });

          if (existing) {
            // Merge / update existing session with the newest metadata and status
            if (childConversationId && !existing.conversationId) {
              existing.conversationId = childConversationId;
            }
            if (stepStatus === "running" || (existing.status !== "running" && stepStatus === "failed")) {
              existing.status = stepStatus;
            } else if (existing.status === "running" && stepStatus === "completed") {
              existing.status = "completed";
            }
            if (output && (!existing.output || output.length > existing.output.length)) {
              existing.output = output;
            }
            if (workSteps.length > (existing.workSteps?.length || 0)) {
              existing.workSteps = workSteps;
            }
            if (diffSummary && !existing.diffSummary) {
              existing.diffSummary = diffSummary;
            }
            if (artifacts.length > (existing.artifacts?.length || 0)) {
              existing.artifacts = artifacts;
            }
            if (prompt && (!existing.prompt || prompt.length > existing.prompt.length)) {
              existing.prompt = prompt;
            }
            if (model && !existing.model) {
              existing.model = model;
            }
          } else {
            const id = `subagent-${idx}-${sIdx}-${role.replace(/\s+/g, "_")}`;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              sessions.push({
                id,
                stepIndex: idx,
                role,
                typeName,
                model,
                prompt,
                duration: (step as any).duration || (step.metadata as any)?.duration,
                status: stepStatus,
                output,
                workSteps,
                rawSteps,
                conversationId: childConversationId,
                artifacts,
                diffSummary,
                timestamp: (step as any).timestamp,
              });
            }
          }
        }
      }
    }
  }

  return sessions;
}

export function useSubagentViewer(steps: TrajectoryStep[] = []) {
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);

  const subagents = useMemo(() => extractSubagentSessions(steps), [steps]);

  const activeSubagent = useMemo(() => {
    if (!activeSubagentId) return null;
    return (
      subagents.find(
        (s) =>
          s.id === activeSubagentId ||
          s.role.toLowerCase() === activeSubagentId.toLowerCase() ||
          s.id.includes(activeSubagentId) ||
          activeSubagentId.includes(s.role),
      ) ?? null
    );
  }, [subagents, activeSubagentId]);

  const openSubagent = useCallback((id: string) => {
    setActiveSubagentId(id);
  }, []);

  const closeSubagent = useCallback(() => {
    setActiveSubagentId(null);
  }, []);

  return {
    subagents,
    activeSubagent,
    activeSubagentId,
    setActiveSubagentId,
    openSubagent,
    closeSubagent,
  };
}
