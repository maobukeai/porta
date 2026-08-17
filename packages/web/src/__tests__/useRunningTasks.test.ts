import { describe, it, expect } from "vitest";
import { extractRunningTasks } from "../hooks/useRunningTasks";
import type { TrajectoryStep } from "../types";

describe("useRunningTasks - extractRunningTasks logic", () => {
  it("extracts active running commands with undefined exitCode", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_RUNNING",
        runCommand: {
          command: "cargo run",
          commandId: "cmd-cargo-1",
          cwd: "/workspace/backend",
          output: "Compiling backend v0.1.0...\n",
        },
      } as any,
    ];

    const tasks = extractRunningTasks(steps, true);
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe("cmd-cargo-1");
    expect(tasks[0].command).toBe("cargo run");
    expect(tasks[0].status).toBe("running");
    expect(tasks[0].output).toContain("Compiling backend");
  });

  it("extracts completed and failed commands with exitCode", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_DONE",
        runCommand: {
          command: "cargo test",
          commandId: "cmd-test-1",
          exitCode: 0,
          output: "test result: ok. 12 passed;\n",
        },
      } as any,
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_ERROR",
        runCommand: {
          command: "cargo build --release",
          commandId: "cmd-build-2",
          exitCode: 101,
          output: "error[E0432]: unresolved import\n",
        },
      } as any,
    ];

    const tasks = extractRunningTasks(steps, false);
    expect(tasks.length).toBe(2);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[1].status).toBe("failed");
    expect(tasks[1].exitCode).toBe(101);
  });

  it("updates task output dynamically via COMMAND_STATUS steps", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_RUNNING",
        runCommand: {
          command: "npm run dev",
          commandId: "cmd-dev-1",
          output: "Starting dev server...\n",
        },
      } as any,
      {
        type: "CORTEX_STEP_TYPE_COMMAND_STATUS",
        commandStatus: {
          commandId: "cmd-dev-1",
          combined: "Ready on http://localhost:3000\n",
          status: "CORTEX_STEP_STATUS_RUNNING",
        },
      } as any,
    ];

    const tasks = extractRunningTasks(steps, true);
    expect(tasks.length).toBe(1);
    expect(tasks[0].output).toBe("Starting dev server...\nReady on http://localhost:3000\n");
    expect(tasks[0].status).toBe("running");
  });

  it("handles termination via SendCommandInput terminate flag", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_RUNNING",
        runCommand: {
          command: "cargo run",
          commandId: "cmd-cargo-1",
        },
      } as any,
      {
        type: "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT",
        sendCommandInput: {
          terminate: true,
        },
      } as any,
    ];

    const tasks = extractRunningTasks(steps, true);
    expect(tasks.length).toBe(1);
    expect(tasks[0].status).toBe("terminated");
  });

  it("handles manage_task tool call with kill action", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_RUNNING",
        runCommand: {
          command: "cargo run",
          commandId: "task-cargo-1",
        },
      } as any,
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "manage_task",
            argumentsJson: JSON.stringify({ Action: "kill", TaskId: "task-cargo-1" }),
          },
        },
      } as any,
    ];

    const tasks = extractRunningTasks(steps, true);
    expect(tasks.length).toBe(1);
    expect(tasks[0].status).toBe("terminated");
  });

  it("downgrades exit-code-less commands to completed when the conversation is idle", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: "CORTEX_STEP_STATUS_RUNNING",
        runCommand: {
          command: "cargo run",
          commandId: "cmd-ghost-1",
        },
      } as any,
    ];

    // Conversation reopened while idle — no ghost "running" task.
    const idle = extractRunningTasks(steps, false);
    expect(idle[0].status).toBe("completed");

    // Same trajectory while the agent is actively running — stays running.
    const active = extractRunningTasks(steps, true);
    expect(active[0].status).toBe("running");
  });
});
