import { describe, it, expect } from "vitest";
import { groupMessagesIntoTurns } from "../components/ChatPanel";
import type { ChatMessage, TrajectoryStep } from "../types";

function stepWithTime(createdAt: string, completedAt?: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT",
    status: "DONE",
    metadata: { createdAt, completedAt },
  } as TrajectoryStep;
}

describe("groupMessagesIntoTurns startedAt (chat day separators)", () => {
  it("assigns startedAt = earliest step timestamp of the turn", () => {
    const messages: ChatMessage[] = [
      {
        type: "chat",
        role: "user",
        content: "第一天的请求",
        stepIndex: 0,
        step: stepWithTime("2026-08-15T10:00:00Z", "2026-08-15T10:00:01Z"),
      },
      {
        type: "chat",
        role: "assistant",
        content: "第一天的回复",
        stepIndex: 1,
        step: stepWithTime("2026-08-15T10:00:10Z", "2026-08-15T10:00:20Z"),
      },
      {
        type: "chat",
        role: "user",
        content: "第二天的请求",
        stepIndex: 2,
        step: stepWithTime("2026-08-16T09:00:00Z"),
      },
      {
        type: "chat",
        role: "assistant",
        content: "第二天的回复",
        stepIndex: 3,
        step: stepWithTime("2026-08-16T09:00:30Z"),
      },
    ];

    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns).toHaveLength(2);
    expect(turns[0].startedAt).toBe(new Date("2026-08-15T10:00:00Z").getTime());
    expect(turns[1].startedAt).toBe(new Date("2026-08-16T09:00:00Z").getTime());
  });

  it("leaves startedAt undefined for turns without step timestamps", () => {
    const messages: ChatMessage[] = [
      { type: "chat", role: "user", content: "无时间戳的请求", stepIndex: 0 },
      { type: "chat", role: "assistant", content: "回复", stepIndex: 1 },
    ];
    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].startedAt).toBeUndefined();
  });

  it("ignores invalid timestamp strings", () => {
    const messages: ChatMessage[] = [
      {
        type: "chat",
        role: "user",
        content: "坏时间戳",
        stepIndex: 0,
        step: stepWithTime("not-a-date"),
      },
      { type: "chat", role: "assistant", content: "回复", stepIndex: 1 },
    ];
    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns[0].startedAt).toBeUndefined();
  });
});
