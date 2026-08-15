import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { TrajectoryStep, ChatMessage, PlanTaskItem, ConversationPlanResponse } from "../types";
import { api } from "../api/client";

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
      if (mark === "x" || mark === "X") {
        status = "completed";
      } else if (mark === "/" || mark === ">" || mark === "-") {
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

import { extractSubagentSessions } from "./useSubagentViewer";

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
    const tasks = hasRemoteTasks ? remotePlan!.tasks : fromSteps.tasks;
    const title = remotePlan?.title || fromSteps.title || "任务规划进展";
    const rawContent = remotePlan?.content || fromSteps.content;

    const subagents = {
      total: Math.max(remotePlan?.subagents?.total ?? 0, subagentsFromSteps.total),
      completed: Math.max(remotePlan?.subagents?.completed ?? 0, subagentsFromSteps.completed),
      active: Math.max(remotePlan?.subagents?.active ?? 0, subagentsFromSteps.active),
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
