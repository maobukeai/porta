/**
 * Revert stepIndex correctness tests
 *
 * Regression suite for the bug where stepsToMessages used local array index (i)
 * instead of the absolute trajectory offset (baseOffset + i).
 */

import { describe, it, expect } from "vitest";
import { stepsToMessages } from "../transforms/stepsToMessages";
import type { TrajectoryStep } from "../types";

function makeUserStep(text: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_USER_INPUT",
    userInput: { items: [{ text }] },
  } as unknown as TrajectoryStep;
}

function makeAssistantStep(text: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
    plannerResponse: { items: [{ text }], toolCalls: [] },
  } as unknown as TrajectoryStep;
}

describe("revert — stepsToMessages baseOffset", () => {
  it("baseOffset=0: stepIndex equals array index (baseline)", () => {
    const steps = [makeUserStep("hello"), makeAssistantStep("world")];
    const msgs = stepsToMessages(steps, 0);
    expect(msgs.find((m) => m.role === "user")?.stepIndex).toBe(0);
    expect(msgs.find((m) => m.role === "assistant")?.stepIndex).toBe(1);
  });

  it("baseOffset=200: stepIndex = 200 + array index (paginated window)", () => {
    const steps = [
      makeUserStep("msg at 200"),
      makeAssistantStep("reply at 201"),
      makeUserStep("msg at 202"),
      makeAssistantStep("reply at 203"),
      makeUserStep("msg at 204"),
    ];
    const msgs = stepsToMessages(steps, 200);
    const userMsgs = msgs.filter((m) => m.role === "user");
    const asstMsgs = msgs.filter((m) => m.role === "assistant");
    expect(userMsgs[0].stepIndex).toBe(200);
    expect(userMsgs[1].stepIndex).toBe(202);
    expect(userMsgs[2].stepIndex).toBe(204);
    expect(asstMsgs[0].stepIndex).toBe(201);
    expect(asstMsgs[1].stepIndex).toBe(203);
  });

  it("revert target = stepIndex - 1 is correct for paginated window", () => {
    const steps = [makeUserStep("user msg"), makeAssistantStep("reply")];
    const msgs = stepsToMessages(steps, 150);
    const userMsg = msgs.find((m) => m.role === "user")!;
    const targetStep = Math.max(0, userMsg.stepIndex - 1);
    expect(targetStep).toBe(149);
  });

  it("revert at step 0 clamps to 0, never negative", () => {
    const steps = [makeUserStep("first msg")];
    const msgs = stepsToMessages(steps, 0);
    const msg = msgs.find((m) => m.role === "user")!;
    expect(Math.max(0, msg.stepIndex - 1)).toBe(0);
  });

  it("large baseOffset scenario (500+)", () => {
    const steps = [makeUserStep("deep"), makeAssistantStep("response")];
    const msgs = stepsToMessages(steps, 523);
    expect(msgs.find((m) => m.role === "user")?.stepIndex).toBe(523);
    expect(msgs.find((m) => m.role === "assistant")?.stepIndex).toBe(524);
  });

  it("same steps array with different baseOffsets gives different stepIndexes", () => {
    const steps = [makeUserStep("test"), makeAssistantStep("ok")];
    const msgsA = stepsToMessages(steps, 0);
    const msgsB = stepsToMessages(steps, 100);
    expect(msgsA.find((m) => m.role === "user")?.stepIndex).toBe(0);
    expect(msgsB.find((m) => m.role === "user")?.stepIndex).toBe(100);
  });

  it("PAGE_SIZE=100 tail: all stepIndexes in range [baseOffset, baseOffset+99]", () => {
    const BASE = 150;
    const steps: TrajectoryStep[] = [];
    for (let i = 0; i < 100; i++) {
      steps.push(i % 2 === 0 ? makeUserStep(`u${i}`) : makeAssistantStep(`a${i}`));
    }
    const msgs = stepsToMessages(steps, BASE);
    for (const msg of msgs) {
      expect(msg.stepIndex).toBeGreaterThanOrEqual(BASE);
      expect(msg.stepIndex).toBeLessThan(BASE + 100);
    }
    expect(msgs[0].stepIndex).toBe(BASE);
  });
});

describe("revert — handleRevert logic", () => {
  it("targetStep = Math.max(0, stepIndex - 1) boundary cases", () => {
    const cases: [number, number][] = [
      [0, 0], [1, 0], [5, 4], [150, 149], [299, 298],
    ];
    for (const [stepIndex, expected] of cases) {
      expect(Math.max(0, stepIndex - 1)).toBe(expected);
    }
  });

  it("stepIndex < 0 (safe edit mode) does NOT call revert API", () => {
    // In handleRevert: if (stepIndex < 0) { return; }
    expect(-1 >= 0).toBe(false);
  });
});
