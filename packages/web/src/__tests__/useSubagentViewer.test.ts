import { describe, it, expect } from "vitest";
import { extractSubagentSessions } from "../hooks/useSubagentViewer";
import type { TrajectoryStep } from "../types";

describe("useSubagentViewer & extractSubagentSessions", () => {
  it("extracts subagent sessions from tool calls correctly", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "Fix reorderTask+rate limiting",
                  TypeName: "subagent",
                  Model: "sensenova/sensenova-6.8-flash-lite",
                  Prompt: "You are a backend engineer fixing production-grade bugs in a Kanban board system.\n\nTask 1: Fix reorderTask...",
                },
                {
                  Role: "Create Vitest test suite",
                  TypeName: "subagent",
                  Model: "gemini-2.5-flash",
                  Prompt: "Write 25+ unit tests...",
                },
              ],
            },
          },
        },
      },
      {
        type: "PLANNER_RESPONSE",
        status: "ERROR",
        errorMessage: "Test execution failed",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "Frontend Polish",
                  TypeName: "subagent",
                  Prompt: "Polish CSS...",
                },
              ],
            },
          },
        },
      },
    ];

    const sessions = extractSubagentSessions(mockSteps);
    expect(sessions.length).toBe(3);

    expect(sessions[0].role).toBe("Fix reorderTask+rate limiting");
    expect(sessions[0].typeName).toBe("subagent");
    expect(sessions[0].model).toBe("sensenova/sensenova-6.8-flash-lite");
    expect(sessions[0].prompt).toContain("You are a backend engineer");
    expect(sessions[0].status).toBe("completed");

    expect(sessions[1].role).toBe("Create Vitest test suite");
    expect(sessions[1].status).toBe("completed");

    expect(sessions[2].role).toBe("Frontend Polish");
    expect(sessions[2].status).toBe("failed");
  });

  it("extracts subagent sessions when tool_calls array and stringified JSON Subagents are used", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "invoke_subagent",
            args: {
              Subagents: JSON.stringify([
                {
                  Role: "Usage Statistics Auditor",
                  TypeName: "self",
                  Model: "inherit",
                  Prompt: "Audit usage stats...",
                },
              ]),
            },
          },
        ],
      } as any,
      {
        type: "PLANNER_RESPONSE",
        status: "RUNNING",
        tool_calls: [
          {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "Active Code Generator",
                  TypeName: "builder",
                  Prompt: "Generating UI...",
                },
              ],
            },
          },
        ],
      } as any,
    ];

    const sessions = extractSubagentSessions(mockSteps);
    expect(sessions.length).toBe(2);
    expect(sessions[0].role).toBe("Usage Statistics Auditor");
    expect(sessions[0].status).toBe("completed");

    expect(sessions[1].role).toBe("Active Code Generator");
    expect(sessions[1].status).toBe("running");
  });
});
