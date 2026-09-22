import { describe, it, expect } from "vitest";
import { extractSubagentSessions } from "../hooks/useSubagentViewer";
import { formatSubagentDuration, formatSubagentRelativeTime } from "../components/SubagentDirectoryView";
import type { TrajectoryStep } from "../types";

describe("useSubagentViewer - extractSubagentSessions", () => {
  it("extracts subagent sessions from invoke_subagent tool calls", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "review-auditor",
                  TypeName: "audit",
                  Prompt: "Review recent code changes for safety",
                  Model: "gemini-2.5-pro",
                },
              ],
            },
          },
        },
      },
    ];

    const sessions = extractSubagentSessions(steps);
    expect(sessions.length).toBe(1);
    expect(sessions[0].role).toBe("review-auditor");
    expect(sessions[0].typeName).toBe("audit");
    expect(sessions[0].model).toBe("gemini-2.5-pro");
    expect(sessions[0].prompt).toBe("Review recent code changes for safety");
  });

  it("updates existing session rawSteps and recalculates status when steps arrive", () => {
    const stepsInitial: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          childConversationId: "conv-child-1",
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                { Role: "worker", Prompt: "Do work" },
              ],
            },
          },
        },
      },
    ];

    const sessions1 = extractSubagentSessions(stepsInitial);
    expect(sessions1.length).toBe(1);
    expect(sessions1[0].conversationId).toBe("conv-child-1");
    expect(sessions1[0].status).toBe("running");

    // Add completion system message
    const stepsFinished: TrajectoryStep[] = [
      ...stepsInitial,
      {
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        content: '{"sender":"conv-child-1", "action":"completed"}',
      },
    ];

    const sessions2 = extractSubagentSessions(stepsFinished);
    expect(sessions2.length).toBe(1);
    expect(sessions2[0].status).toBe("completed");
  });

  it("detects needsAttention when child subagent has waiting step", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          childConversationId: "conv-waiting",
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [{ Role: "permission-worker", Prompt: "Run dangerous command" }],
            },
          },
        },
      },
      {
        type: "TOOL_CALL",
        status: "WAITING",
        metadata: {
          toolCall: {
            name: "ask_permission",
            args: { command: "rm -rf /" },
          },
        },
      },
    ];

    const sessions = extractSubagentSessions(steps);
    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe("running");
    expect(sessions[0].needsAttention).toBe(true);
  });
});

describe("SubagentDirectoryView formatting helpers", () => {
  describe("formatSubagentDuration", () => {
    it("formats seconds less than 60", () => {
      expect(formatSubagentDuration("45s")).toBe("45秒");
      expect(formatSubagentDuration(30)).toBe("30秒");
      expect(formatSubagentDuration("0s")).toBe("1秒");
    });

    it("formats minutes and seconds accurately", () => {
      expect(formatSubagentDuration("125s")).toBe("2分5秒");
      expect(formatSubagentDuration(120)).toBe("2分钟");
      expect(formatSubagentDuration(360)).toBe("6分钟");
      expect(formatSubagentDuration("65s")).toBe("1分5秒");
    });

    it("formats millisecond strings", () => {
      expect(formatSubagentDuration("1500ms")).toBe("2秒");
      expect(formatSubagentDuration("65000ms")).toBe("1分5秒");
    });

    it("returns raw string if not matching seconds or ms pattern", () => {
      expect(formatSubagentDuration("unparsed duration")).toBe("unparsed duration");
    });
  });

  describe("formatSubagentRelativeTime", () => {
    it("formats relative time into Chinese units", () => {
      const now = Date.now();
      expect(formatSubagentRelativeTime(new Date(now - 10000).toISOString())).toBe("刚刚");
      expect(formatSubagentRelativeTime(new Date(now - 120000).toISOString())).toBe("2分钟前");
      expect(formatSubagentRelativeTime(new Date(now - 3600000 * 3).toISOString())).toBe("3小时前");
      expect(formatSubagentRelativeTime(new Date(now - 86400000 * 4).toISOString())).toBe("4天");
    });
  });
});
