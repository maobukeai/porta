import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../components/ChatPanel";
import { useStepsStream } from "../hooks/useStepsStream";
import type { TrajectoryStep } from "../types";

vi.mock("../hooks/useStepsStream", () => ({
  useStepsStream: vi.fn(),
}));

vi.mock("../hooks/useChatNotifications", () => ({
  useChatNotifications: vi.fn(),
}));

const mockUseStepsStream = vi.mocked(useStepsStream);

function mockSteps(steps: TrajectoryStep[], wsRunning = false) {
  mockUseStepsStream.mockReturnValue({
    steps,
    baseOffset: 0,
    loading: false,
    error: null,
    hasMore: false,
    loadingOlder: false,
    wsRunning,
    loadOlder: vi.fn().mockResolvedValue(0),
    refresh: vi.fn(),
    hardRefresh: vi.fn(),
  });
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders planner thinking as an implementation plan panel", () => {
    mockSteps([
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "I will make the change.",
          thinking: "Inspect the current chat UI, then expose the plan.",
          thinkingDuration: "3.4s",
        },
      },
    ]);

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    expect(screen.getByText(/已工作.*3.*秒/)).toBeInTheDocument();
    expect(
      screen.getByText("Inspect the current chat UI, then expose the plan."),
    ).toBeInTheDocument();
  });

  it("shows the latest plan as a live panel while the run is active", () => {
    mockSteps(
      [
        {
          type: "CORTEX_STEP_TYPE_USER_INPUT",
          userInput: { items: [{ text: "Please implement this" }] },
        },
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          plannerResponse: {
            thinking: "Inspect first, then patch the UI.",
            thinkingDuration: "1.2s",
          },
        },
      ],
      true,
    );

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    expect(screen.getByText("正在深度思考与执行…")).toBeInTheDocument();
    expect(
      document.querySelector(".pinned-implementation-plan-message"),
    ).toBeInTheDocument();
  });

  it("keeps the live plan pinned above the answer after the run ends", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "Please implement this" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          thinking: "Inspect first, then patch the UI.",
          thinkingDuration: "1.2s",
        },
      },
    ];
    const completedSteps: TrajectoryStep[] = [
      ...steps,
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "Final answer.",
        },
      },
    ];
    const props = {
      cascadeId: "cascade-1",
      onRevert: vi.fn(),
      onFilePermission: vi.fn(),
    };

    mockSteps(steps, true);
    const { rerender } = render(<ChatPanel {...props} />);
    expect(screen.getByText("正在深度思考与执行…")).toBeInTheDocument();

    mockSteps(completedSteps, false);
    rerender(<ChatPanel {...props} />);

    expect(
      screen.queryByText("正在深度思考与执行…"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/已工作.*1.*秒/)).toBeInTheDocument();
    const messageElements = Array.from(document.querySelectorAll(".message"));
    const planElement = document.querySelector(
      ".pinned-implementation-plan-message",
    );
    const answerElement = screen.getByText("Final answer.");
    const planIndex = messageElements.indexOf(planElement as Element);
    const answerIndex = messageElements.findIndex((element) =>
      element.contains(answerElement),
    );

    expect(planElement).toBeInTheDocument();
    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(planIndex);
  });

  it("renders QuotaAlertCard outside the thinking block when a quota error occurs", () => {
    mockSteps([
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "Write some code" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          thinking: "Thinking about the architecture...",
          thinkingDuration: "57s",
        },
      },
      {
        type: "CORTEX_STEP_TYPE_ERROR",
        errorMessage:
          "Resource exhausted: baseline model quota reached for gemini-2.5-pro",
      },
    ]);

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    // The work duration header exists
    expect(screen.getByText(/已工作.*57.*秒/)).toBeInTheDocument();

    // The quota alert card is in the document with the translated title
    const quotaTitle = screen.getByText("基准模型配额已达上限");
    expect(quotaTitle).toBeInTheDocument();

    // Verify QuotaAlertCard is outside the thinking block (.zcode-thinking-block)
    const thinkingBlock = document.querySelector(".zcode-thinking-block");
    expect(thinkingBlock).toBeInTheDocument();
    expect(thinkingBlock?.contains(quotaTitle)).toBe(false);

    // Verify it is inside .turn-error-container
    const errorContainer = document.querySelector(".turn-error-container");
    expect(errorContainer).toBeInTheDocument();
    expect(errorContainer?.contains(quotaTitle)).toBe(true);
  });

  it("deduplicates multiple quota error attempts into a single alert card per turn", () => {
    mockSteps([
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "Write some code" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          thinking: "Thinking...",
          thinkingDuration: "10s",
        },
      },
      // First attempt failure
      {
        type: "CORTEX_STEP_TYPE_ERROR",
        errorMessage:
          "Resource exhausted: baseline model quota reached for gemini-2.5-pro. Quota will refresh at 2026-08-14T19:00:00Z",
      },
      // Second attempt retry failure
      {
        type: "CORTEX_STEP_TYPE_ERROR",
        errorMessage:
          "Resource exhausted: baseline model quota reached for gemini-2.5-pro",
      },
      // Third attempt retry failure
      {
        type: "CORTEX_STEP_TYPE_ERROR",
        errorMessage:
          "Resource exhausted: rate limit exceeded",
      },
    ]);

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    // There should be exactly 1 quota title rendered, not 3
    const quotaTitles = screen.getAllByText("基准模型配额已达上限");
    expect(quotaTitles).toHaveLength(1);

    // The single card should have picked the most informative baseline quota error (with refresh time)
    expect(screen.getByText(/2026-08-14T19:00:00Z/)).toBeInTheDocument();
  });

  it("does not render TurnSummaryCard while wsRunning is true, but displays it once completed", () => {
    const fileChangeSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "Change the settings file" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_CODE_ACTION",
        codeAction: {
          actionResult: {
            edit: {
              absoluteUri: "file:///src/Settings.tsx",
              diff: {
                unifiedDiff: {
                  lines: [
                    { type: "UNIFIED_DIFF_LINE_TYPE_INSERT", text: "const x = 2;" },
                    { type: "UNIFIED_DIFF_LINE_TYPE_DELETE", text: "const x = 1;" },
                  ],
                },
              },
            },
          },
        },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "I have updated Settings.tsx.",
        },
      },
    ];

    // Case 1: Active running state -> TurnSummaryCard should NOT be rendered
    mockSteps(fileChangeSteps, true);
    const { rerender } = render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );
    expect(screen.queryByText(/1 file changed/i)).toBeNull();

    // Case 2: Run completes -> TurnSummaryCard should be rendered
    mockSteps(fileChangeSteps, false);
    rerender(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 file changed/i)).toBeInTheDocument();
  });
});
