import type { TrajectoryStep } from "../types";

const WAITING_TASKS_KEY = "porta:waitingTasks_v1";

export function isAnyStepWaiting(steps?: TrajectoryStep[]): boolean {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return false;
  return steps.some((s) => {
    if (s.completedInteractions && s.completedInteractions.length > 0) return false;
    const st = String(s.status ?? "").toUpperCase();
    if (
      st.includes("DONE") ||
      st.includes("COMPLETE") ||
      st.includes("CANCEL") ||
      st.includes("ERROR")
    ) {
      return false;
    }
    return (
      s.type === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
      s.type === "CORTEX_STEP_TYPE_FILE_PERMISSION" ||
      s.requestedInteraction !== undefined ||
      (s.type === "CORTEX_STEP_TYPE_RUN_COMMAND" && st.includes("WAITING"))
    );
  });
}

export function loadWaitingTasks(): Set<string> {
  try {
    const raw = localStorage.getItem(WAITING_TASKS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveWaitingTasks(tasks: Set<string>): void {
  try {
    localStorage.setItem(WAITING_TASKS_KEY, JSON.stringify(Array.from(tasks)));
  } catch {}
}

export function setConversationWaiting(cascadeId: string, isWaiting: boolean): void {
  if (!cascadeId) return;
  const current = loadWaitingTasks();
  let changed = false;
  if (isWaiting && !current.has(cascadeId)) {
    current.add(cascadeId);
    changed = true;
  } else if (!isWaiting && current.has(cascadeId)) {
    current.delete(cascadeId);
    changed = true;
  }

  if (changed) {
    saveWaitingTasks(current);
    window.dispatchEvent(
      new CustomEvent("porta:waiting-tasks-updated", {
        detail: { cascadeId, isWaiting, all: Array.from(current) },
      }),
    );
  }
}
