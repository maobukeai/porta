import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubagentCard } from "../components/StepCards";
import type { TrajectoryStep } from "../types";

function nativeStep(
  status = "CORTEX_STEP_STATUS_DONE",
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_INVOKE_SUBAGENT",
    status,
    invokeSubagent: {
      subagents: [
        {
          role: "Integration Reviewer",
          typeName: "general-purpose",
          initialPrompt: "Review the integration",
        },
        {
          role: "Security Reviewer",
          typeName: "research",
          initialPrompt: "Review security boundaries",
        },
      ],
    },
  };
}

describe("SubagentCard", () => {
  it("renders every native subagent and allows opening subagent details", async () => {
    const onSelectSubagent = vi.fn();
    render(<SubagentCard step={nativeStep()} onSelectSubagent={onSelectSubagent} />);

    expect(screen.getByText("Integration Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("general-purpose")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    await userEvent.click(buttons[0]);
    expect(onSelectSubagent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["CORTEX_STEP_STATUS_ERROR", "执行失败", "is-failed"],
    ["CORTEX_STEP_STATUS_RUNNING", "执行中", "is-running"],
  ])("renders %s with the correct state tag", (status, tagLabel, className) => {
    const { container } = render(<SubagentCard step={nativeStep(status)} />);

    expect(screen.getAllByText(tagLabel).length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".zcode-subagent-list-row")).toHaveClass(className);
  });

  it("renders tool-specific send_message content", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_TOOL_CALL",
      metadata: {
        toolCall: {
          name: "send_message",
          argumentsJson: JSON.stringify({
            Recipient: "conversation-123",
            Message: "Please inspect the auth flow",
          }),
        },
      },
    };
    render(<SubagentCard step={step} />);

    expect(screen.getByText("conversation-123")).toBeInTheDocument();
    expect(screen.getByText("message")).toBeInTheDocument();
  });

  it("renders untrusted labels as text rather than HTML", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_INVOKE_SUBAGENT",
      invokeSubagent: {
        subagents: [
          {
            role: '<img src=x onerror="alert(1)">',
            initialPrompt: "safe text",
          },
        ],
      },
    };
    const { container } = render(<SubagentCard step={step} />);

    expect(
      screen.getByText('<img src=x onerror="alert(1)">'),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
