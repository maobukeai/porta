import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { TrajectoryStep, ChatMessage, PlanTaskItem, ConversationPlanResponse } from "../types";
import { api } from "../api/client";
import { extractSubagentSessions } from "./useSubagentViewer";

export interface PlanProgressData {
  hasPlan: boolean;
  conversationId: string;
  title: string;
  tasks: PlanTaskItem[];
  total: number;
  completedCount: number;
  completedSteps: PlanTaskItem[];
  currentStep: PlanTaskItem | null;
  upcomingSteps: PlanTaskItem[];
  overflowSteps: PlanTaskItem[];
  subagents: {
    total: number;
    completed: number;
    active: number;
  };
  content?: string;
  loading: boolean;
  refresh: () => Promise<void>;
}

function cleanPath(p?: string): string {
  if (!p) return "";
  return p
    .replace(/^file:\/\/\/?/, "")
    .replace(/^[a-zA-Z]:[\\/]/, "")
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/")
    .trim();
}

/**
 * Extracts emoji icon at start of string or within string.
 */
export function extractEmoji(text: string): { icon?: string; cleanTitle: string } {
  // Check for leading emoji
  const emojiMatch = text.match(/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*(.*)$/u);
  if (emojiMatch) {
    return {
      icon: emojiMatch[1],
      cleanTitle: emojiMatch[2].trim(),
    };
  }

  // Check for common coding/task emoji symbols
  const commonEmoji = /(?:🔧|🧪|🔔|📎|📅|💎|⚡|🚀|📦|🎨|📝|🛡️|🔍|⚙️|✨|💡|🐛|🔨|📊|🎯|🏷️)/u;
  const match = text.match(commonEmoji);
  if (match) {
    const icon = match[0];
    const cleanTitle = text.replace(icon, "").replace(/^[:\-–—\s]+/, "").trim();
    return { icon, cleanTitle: cleanTitle || text };
  }

  return { cleanTitle: text };
}

/**
 * Parses markdown plan or message content into structured tasks.
 */
export function parseTasksFromMarkdown(content: string): { title?: string; tasks: PlanTaskItem[] } {
  if (!content || !content.trim()) {
    return { tasks: [] };
  }

  const lines = content.split("\n");
  let title: string | undefined;
  const tasks: PlanTaskItem[] = [];
  let taskIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Extract H1 title if not yet found
    if (!title && rawLine.startsWith("# ")) {
      title = rawLine.slice(2).replace(/^[#\s]+/, "").trim();
      continue;
    }

    // 1. Checklist item: `- [x] ...` or `- [ ] ...` or `* [x] ...`
    const checkboxMatch = rawLine.match(/^[-*]\s*\[([ xX/->])\]\s*(.*)$/);
    if (checkboxMatch) {
      taskIndex++;
      const mark = checkboxMatch[1];
      let taskText = checkboxMatch[2].trim();
      taskText = taskText.replace(/^\*\*([\s\S]*?)\*\*$/, "$1").trim();

      let status: "completed" | "running" | "pending" = "pending";
      if (
        mark === "x" ||
        mark === "X" ||
        taskText.includes("✅") ||
        taskText.includes("(done)") ||
        taskText.includes("(completed)") ||
        taskText.includes("(已完成)") ||
        rawLine.includes("~~")
      ) {
        status = "completed";
      } else if (
        mark === "/" ||
        mark === ">" ||
        mark === "-" ||
        taskText.includes("(in progress)") ||
        taskText.includes("(进行中)")
      ) {
        status = "running";
      }

      const { icon, cleanTitle } = extractEmoji(taskText);

      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status,
        rawText: taskText,
      });
      continue;
    }

    // 2. Active pointer step: `-> 🔧 ...` or `=> ...`
    const arrowMatch = rawLine.match(/^(?:->|=>|→)\s*(.*)$/);
    if (arrowMatch) {
      taskIndex++;
      const taskText = arrowMatch[1].trim().replace(/^\*\*([\s\S]*?)\*\*$/, "$1").trim();
      const { icon, cleanTitle } = extractEmoji(taskText);
      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status: "running",
        rawText: taskText,
      });
      continue;
    }

    // 3. Step Header: `### Step 1: ...` or `### 1. ...`
    const stepHeaderMatch = rawLine.match(/^#{2,4}\s+(?:Step\s*\d+[:.]?|\d+[.:])\s*(.*)$/i);
    if (stepHeaderMatch) {
      taskIndex++;
      const taskText = stepHeaderMatch[1].trim();
      const { icon, cleanTitle } = extractEmoji(taskText);
      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status: "pending",
        rawText: taskText,
      });
      continue;
    }
  }

  // If no task was marked as 'running' and not all are completed, find first pending
  const hasRunning = tasks.some((t) => t.status === "running");
  if (!hasRunning && tasks.length > 0) {
    const firstPendingIdx = tasks.findIndex((t) => t.status === "pending");
    if (firstPendingIdx !== -1) {
      tasks[firstPendingIdx].status = "running";
    }
  }

  return { title, tasks };
}

/**
 * Dynamically updates task statuses by matching against real-time trajectory steps.
 * When files are modified, commands succeed, or steps progress, tasks are checked off automatically!
 */
export function applyDynamicStepProgress(tasks: PlanTaskItem[], steps: TrajectoryStep[] = []): PlanTaskItem[] {
  if (!tasks || tasks.length === 0) return tasks;
  if (!steps || steps.length === 0) return tasks;

  // Extract touched files, executed commands, and artifact signals
  const touchedFiles = new Set<string>();
  const completedCommands: string[] = [];
  let hasWalkthrough = false;
  let hasGitCommit = false;

  for (const step of steps) {
    const toolCall = step.metadata?.toolCall || (step as any).toolCall;
    let args: any = toolCall?.args;
    if (!args && toolCall?.argumentsJson) {
      try {
        args = JSON.parse(toolCall.argumentsJson);
      } catch {}
    }

    const toolName = toolCall?.name || (step.type ? String(step.type) : "");

    if (
      toolName.includes("write_to_file") ||
      toolName.includes("replace_file_content") ||
      step.replaceFileContent ||
      step.viewFile
    ) {
      const file =
        args?.TargetFile ||
        args?.targetFile ||
        args?.path ||
        args?.AbsolutePath ||
        step.replaceFileContent?.targetFile ||
        step.viewFile?.absolutePathUri;
      if (file) {
        const clean = cleanPath(file).toLowerCase();
        touchedFiles.add(clean);
        if (clean.includes("walkthrough.md")) {
          hasWalkthrough = true;
        }
      }
    } else if (toolName.includes("run_command") || step.runCommand) {
      const cmd = (args?.CommandLine || args?.commandLine || step.runCommand?.commandLine || "").toLowerCase();
      if (cmd) {
        completedCommands.push(cmd);
        if (cmd.includes("git commit") || cmd.includes("git add")) {
          hasGitCommit = true;
        }
      }
    }
  }

  const updated = tasks.map((t) => ({ ...t }));
  let highestCompletedIndex = -1;

  for (let i = 0; i < updated.length; i++) {
    const task = updated[i];
    if (task.status === "completed") {
      highestCompletedIndex = Math.max(highestCompletedIndex, i);
      continue;
    }

    const text = (task.rawText || task.title).toLowerCase();

    // 1. Check file modifications mentioned in task
    let fileMatched = false;
    for (const file of touchedFiles) {
      const baseName = file.split("/").pop() || file;
      if (text.includes(baseName) || (baseName.length > 5 && text.includes(baseName.replace(/\.[^.]+$/, "")))) {
        fileMatched = true;
        break;
      }
    }

    // 2. Check test execution tasks
    const isTestRunTask =
      text.includes("run test") ||
      text.includes("test to verify") ||
      text.includes("verify pass") ||
      text.includes("verify fail") ||
      text.includes("运行测试");
    const testRan =
      isTestRunTask && completedCommands.some((c) => c.includes("test") || c.includes("vitest") || c.includes("jest"));

    // 3. Check commit tasks
    const isCommitTask = text.includes("commit") || text.includes("提交");
    const commitDone = isCommitTask && (hasGitCommit || hasWalkthrough || i < updated.length - 1);

    if (fileMatched || testRan || commitDone) {
      task.status = "completed";
      highestCompletedIndex = Math.max(highestCompletedIndex, i);
    }
  }

  // Cascading completion: all steps before the latest completed step are marked complete
  if (highestCompletedIndex >= 0) {
    for (let i = 0; i <= highestCompletedIndex; i++) {
      updated[i].status = "completed";
    }
  }

  // If walkthrough.md has been generated, all tasks are completed
  if (hasWalkthrough && updated.length > 0) {
    for (let i = 0; i < updated.length; i++) {
      updated[i].status = "completed";
    }
  }

  // Next incomplete step becomes 'running'
  const firstIncomplete = updated.findIndex((t) => t.status !== "completed");
  if (firstIncomplete !== -1) {
    updated[firstIncomplete].status = "running";
    for (let i = firstIncomplete + 1; i < updated.length; i++) {
      if (updated[i].status !== "completed") {
        updated[i].status = "pending";
      }
    }
  }

  return updated;
}

/**
 * Extracts subagent statistics from trajectory steps.
 */
export function extractSubagentStatsFromSteps(steps: TrajectoryStep[] = []): { total: number; completed: number; active: number } {
  const sessions = extractSubagentSessions(steps);
  const total = sessions.length;
  const active = sessions.filter((s) => s.status === "running").length;
  const completed = sessions.filter((s) => s.status === "completed" || s.status === "failed").length;

  return { total, completed, active };
}

/**
 * Extracts plan markdown from steps (e.g. write_to_file on implementation_plan.md).
 */
export function extractPlanFromSteps(steps: TrajectoryStep[] = []): { content?: string; title?: string; tasks: PlanTaskItem[] } {
  let latestPlanContent = "";

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const toolCall = step.metadata?.toolCall || (step as any).toolCall;
    if (toolCall) {
      let args = toolCall.args;
      if (!args && toolCall.argumentsJson) {
        try {
          args = JSON.parse(toolCall.argumentsJson);
        } catch {}
      }

      if (args) {
        const path = (args.TargetFile || args.targetFile || args.path || "").toLowerCase();
        if (path.includes("implementation_plan.md") || path.includes("plan.md")) {
          const content = args.CodeContent || args.content || args.code || args.ReplacementContent;
          if (content && typeof content === "string" && content.trim()) {
            latestPlanContent = content;
            break;
          }
        }
      }
    }
  }

  if (latestPlanContent) {
    return {
      content: latestPlanContent,
      ...parseTasksFromMarkdown(latestPlanContent),
    };
  }

  return { tasks: [] };
}

export function usePlanTracker(
  cascadeId?: string | null,
  steps: TrajectoryStep[] = [],
  _messages: ChatMessage[] = [],
  pollingInterval = 6000,
): PlanProgressData {
  const [remotePlan, setRemotePlan] = useState<ConversationPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const prevCascadeId = useRef<string | null>(null);

  const fetchRemotePlan = useCallback(async () => {
    if (!cascadeId) {
      setRemotePlan(null);
      return;
    }

    try {
      setLoading(true);
      const res = await api.getPlan(cascadeId);
      if (res) {
        setRemotePlan(res);
      }
    } catch {
      // Ignore network / offline error, fallback to step memory
    } finally {
      setLoading(false);
    }
  }, [cascadeId]);

  useEffect(() => {
    if (cascadeId !== prevCascadeId.current) {
      prevCascadeId.current = cascadeId ?? null;
      setRemotePlan(null);
      if (cascadeId) {
        void fetchRemotePlan();
      }
    }
  }, [cascadeId, fetchRemotePlan]);

  // Periodic poll if conversation has a plan
  useEffect(() => {
    if (!cascadeId) return;
    const timer = setInterval(() => {
      void fetchRemotePlan();
    }, pollingInterval);

    return () => clearInterval(timer);
  }, [cascadeId, pollingInterval, fetchRemotePlan]);

  // Derive plan data from both remote API and in-memory trajectory steps
  const planData = useMemo(() => {
    const fromSteps = extractPlanFromSteps(steps);
    const subagentsFromSteps = extractSubagentStatsFromSteps(steps);

    // Prefer remote parsed plan if available and has tasks, otherwise fallback to in-memory parsed plan
    const hasRemoteTasks = Boolean(remotePlan?.hasPlan && remotePlan.tasks && remotePlan.tasks.length > 0);
    const rawTasks = hasRemoteTasks ? remotePlan!.tasks : fromSteps.tasks;
    const tasks = applyDynamicStepProgress(rawTasks, steps);
    const title = remotePlan?.title || fromSteps.title || "任务规划进展";
    const rawContent = remotePlan?.content || fromSteps.content;

    const subagents = {
      total: subagentsFromSteps.total,
      completed: subagentsFromSteps.completed,
      active: subagentsFromSteps.active,
    };

    const hasPlan =
      tasks.length > 0 ||
      Boolean(remotePlan?.hasPlan) ||
      subagents.total > 0 ||
      subagents.active > 0;

    const completedSteps: PlanTaskItem[] = [];
    let currentStep: PlanTaskItem | null = null;
    const pendingSteps: PlanTaskItem[] = [];

    for (const t of tasks) {
      if (t.status === "completed") {
        completedSteps.push(t);
      } else if (t.status === "running") {
        if (!currentStep) {
          currentStep = t;
        } else {
          pendingSteps.push(t);
        }
      } else {
        pendingSteps.push(t);
      }
    }

    // If no running task but there are pending tasks, first pending is current
    if (!currentStep && pendingSteps.length > 0) {
      currentStep = pendingSteps.shift()!;
      currentStep.status = "running";
    }

    // Direct upcoming: first 2 pending
    const upcomingSteps = pendingSteps.slice(0, 2);
    // Overflow pending: the rest
    const overflowSteps = pendingSteps.slice(2);

    return {
      hasPlan,
      conversationId: cascadeId || "",
      title,
      tasks,
      total: tasks.length,
      completedCount: completedSteps.length,
      completedSteps,
      currentStep,
      upcomingSteps,
      overflowSteps,
      subagents,
      content: rawContent,
    };
  }, [cascadeId, steps, remotePlan]);

  return {
    ...planData,
    loading,
    refresh: fetchRemotePlan,
  };
}
