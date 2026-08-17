import { useState, useMemo, useCallback } from "react";
import type { TrajectoryStep, RunningTask, RunningTaskStatus } from "../types";
import { api } from "../api/client";
import { triggerHaptic } from "../utils/haptics";

/**
 * Extracts running and historical tasks from trajectory steps.
 * Accurately tracks long-running background tasks (like `cargo run`, `npm run dev`, daemons, timers).
 */
export function extractRunningTasks(
  steps: TrajectoryStep[] = [],
  wsRunning = false,
): RunningTask[] {
  const taskMap = new Map<string, RunningTask>();
  const order: string[] = [];

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const type = step.type || "";
    const meta = step.metadata || {};
    const toolCall = meta.toolCall;
    const toolName = toolCall?.name || "";

    // Parse tool arguments safely
    let argsObj: Record<string, any> = {};
    if (toolCall?.argumentsJson) {
      try {
        argsObj = JSON.parse(toolCall.argumentsJson);
      } catch {}
    } else if (toolCall?.args) {
      argsObj = toolCall.args;
    } else if (Array.isArray((step as any).tool_calls)) {
      for (const tc of (step as any).tool_calls) {
        if (tc.name === "run_command" || tc.function?.name === "run_command") {
          argsObj = tc.args || tc.function?.arguments || {};
          if (typeof argsObj === "string") {
            try {
              argsObj = JSON.parse(argsObj);
            } catch {}
          }
          break;
        }
      }
    }

    // 1. CORTEX_STEP_TYPE_RUN_COMMAND or toolCall === "run_command"
    const isRunCommand =
      type === "CORTEX_STEP_TYPE_RUN_COMMAND" ||
      type === "RUN_COMMAND" ||
      Boolean(step.runCommand) ||
      toolName === "run_command" ||
      toolName.endsWith("run_command") ||
      Boolean(argsObj.CommandLine) ||
      Boolean(argsObj.command);

    if (isRunCommand) {
      const cmdObj = step.runCommand;
      const rawCommand =
        cmdObj?.commandLine ||
        cmdObj?.command ||
        cmdObj?.proposedCommandLine ||
        argsObj.CommandLine ||
        argsObj.command ||
        "";

      if (rawCommand || cmdObj?.commandId) {
        const commandId =
          cmdObj?.commandId ||
          `cmd-${idx}-${(rawCommand || "task").slice(0, 24).replace(/\s+/g, "_")}`;
        const taskId = commandId;

        const cwd = cmdObj?.cwd || argsObj.Cwd || argsObj.cwd || "";
        const isDaemon = Boolean(argsObj.IsDaemon || argsObj.isDaemon);
        const exitCode = cmdObj?.exitCode;
        const rawOutput = cmdObj?.combinedOutput?.full || cmdObj?.output || "";
        const isWaiting =
          String(step.status ?? "").toUpperCase().includes("WAIT") ||
          rawCommand.includes("Waiting for approval");

        let status: RunningTaskStatus = "running";
        if (typeof exitCode === "number") {
          status = exitCode === 0 ? "completed" : "failed";
        } else if (isWaiting) {
          status = "waiting";
        } else {
          // No exit code => task is still active/running in background
          status = "running";
        }

        const displayCommand =
          rawCommand.length > 60
            ? rawCommand.slice(0, 57) + "..."
            : rawCommand || "执行后台命令";

        const task: RunningTask = {
          id: taskId,
          stepIndex: idx,
          command: rawCommand,
          displayCommand,
          commandId,
          trajectoryId: (step as any).trajectoryId || (meta as any).trajectoryId,
          cwd,
          status,
          kind: isDaemon ? "daemon" : "command",
          exitCode,
          output: rawOutput,
          isDaemon,
          timestamp: (step as any).created_at || (step as any).timestamp,
        };

        if (!taskMap.has(taskId)) {
          order.push(taskId);
        }
        taskMap.set(taskId, task);
      }
    }

    // 2. Command Status update stream
    if (
      type === "CORTEX_STEP_TYPE_COMMAND_STATUS" ||
      Boolean(step.commandStatus)
    ) {
      const cs = step.commandStatus;
      if (cs?.commandId && taskMap.has(cs.commandId)) {
        const existing = taskMap.get(cs.commandId)!;
        if (cs.combined) {
          existing.output = (existing.output || "") + cs.combined;
        }
        if (cs.status === "CORTEX_STEP_STATUS_DONE") {
          existing.status = "completed";
          if (existing.exitCode === undefined) existing.exitCode = 0;
        } else if (cs.status === "CORTEX_STEP_STATUS_ERROR") {
          existing.status = "failed";
          if (existing.exitCode === undefined) existing.exitCode = 1;
        }
      }
      continue;
    }

    // 3. Send Command Input (Termination)
    if (
      type === "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT" ||
      Boolean(step.sendCommandInput)
    ) {
      if (step.sendCommandInput?.terminate) {
        // Mark the target command (or most recent running command) as terminated
        const targetCmdId = (step.sendCommandInput as any).commandId;
        if (targetCmdId && taskMap.has(targetCmdId)) {
          taskMap.get(targetCmdId)!.status = "terminated";
        } else {
          for (let j = order.length - 1; j >= 0; j--) {
            const t = taskMap.get(order[j]);
            if (t && t.status === "running") {
              t.status = "terminated";
              break;
            }
          }
        }
      }
      continue;
    }

    // 4. manage_task tool calls (list, kill, status, send_input)
    if (toolName === "manage_task" || toolName.endsWith("manage_task")) {
      const action = String(argsObj.Action || argsObj.action || "").toLowerCase();
      const targetTaskId = argsObj.TaskId || argsObj.taskId;

      if (action === "kill" && targetTaskId && taskMap.has(targetTaskId)) {
        const t = taskMap.get(targetTaskId)!;
        t.status = "terminated";
      } else if (action === "kill_all") {
        for (const t of taskMap.values()) {
          if (t.status === "running") {
            t.status = "terminated";
          }
        }
      }
    }
  }

  const result: RunningTask[] = [];
  for (const id of order) {
    const t = taskMap.get(id);
    if (t) {
      result.push(t);
    }
  }

  // A command without an exit code is only genuinely alive while this
  // conversation is actively executing. Without this guard, historical
  // commands whose exit code was never written back stay "running" forever
  // ("ghost tasks") whenever the conversation is reopened.
  if (!wsRunning) {
    for (const t of result) {
      if (t.status === "running") {
        t.status = "completed";
      }
    }
  }

  return result;
}

export interface UseRunningTasksResult {
  /** All detected tasks in this conversation */
  tasks: RunningTask[];
  /** Currently active / running tasks */
  runningTasks: RunningTask[];
  /** Number of currently active tasks */
  activeCount: number;
  /** Primary active task (for single-line capsule display) */
  primaryActiveTask: RunningTask | null;
  /** Terminate a specific running task */
  terminateTask: (taskId: string) => Promise<void>;
  /** Send input to a running task */
  sendInput: (taskId: string, input: string) => Promise<void>;
}

export function useRunningTasks(
  cascadeId?: string | null,
  steps: TrajectoryStep[] = [],
  wsRunning = false,
): UseRunningTasksResult {
  const [terminatedIds, setTerminatedIds] = useState<Set<string>>(new Set());

  const tasks = useMemo(() => {
    const raw = extractRunningTasks(steps, wsRunning);
    if (terminatedIds.size === 0) return raw;
    return raw.map((t) => {
      if (terminatedIds.has(t.id)) {
        return { ...t, status: "terminated" as const };
      }
      return t;
    });
  }, [steps, wsRunning, terminatedIds]);

  const runningTasks = useMemo(() => {
    return tasks.filter((t) => t.status === "running" || t.status === "waiting");
  }, [tasks]);

  const primaryActiveTask = runningTasks[0] || null;

  const terminateTask = useCallback(
    async (taskId: string) => {
      triggerHaptic("heavy");
      setTerminatedIds((prev) => new Set(prev).add(taskId));

      if (cascadeId) {
        try {
          await api.terminateTask?.(cascadeId, taskId);
        } catch (err) {
          // Roll back the optimistic mark — the proxy reported failure,
          // so the task is still alive.
          setTerminatedIds((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          console.error("Failed to terminate task:", err);
        }
      }
    },
    [cascadeId],
  );

  const sendInput = useCallback(
    async (taskId: string, input: string) => {
      triggerHaptic("light");
      if (cascadeId) {
        try {
          await api.sendTaskInput?.(cascadeId, taskId, input);
        } catch (err) {
          console.error("Failed to send task input:", err);
        }
      }
    },
    [cascadeId],
  );

  return {
    tasks,
    runningTasks,
    activeCount: runningTasks.length,
    primaryActiveTask,
    terminateTask,
    sendInput,
  };
}
