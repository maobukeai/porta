import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubagentDetailViewer } from "../components/SubagentDetailViewer";
import type { SubagentSession } from "../hooks/useSubagentViewer";

describe("SubagentDetailViewer Component", () => {
  const mockSubagent: SubagentSession = {
    id: "subagent-1",
    stepIndex: 1,
    role: "Fix reorderTask+rate limiting",
    typeName: "subagent",
    model: "sensenova/sensenova-6.8-flash-lite",
    prompt: "You are a backend engineer fixing production-grade bugs in a Kanban board system.",
    duration: "1m 11s",
    status: "completed",
    output: "All changes are correct. Here is a summary of what was done:\n\nTask 1: reorderTask logic fix",
  };

  it("renders subagent tab, model info, prompt, duration, and output", () => {
    const onClose = vi.fn();
    render(<SubagentDetailViewer subagent={mockSubagent} onClose={onClose} />);

    // Tab
    expect(screen.getByText("Fix reorderTask+rate limiting")).toBeInTheDocument();

    // Model info
    expect(screen.getByText(/正在使用 sensenova\/sensenova-6.8-flash-lite/)).toBeInTheDocument();

    // Prompt
    expect(screen.getByText(/You are a backend engineer fixing production-grade bugs/)).toBeInTheDocument();

    // Duration
    expect(screen.getByText(/已工作 1 分 11 秒/)).toBeInTheDocument();

    // Output
    expect(screen.getByText(/All changes are correct/)).toBeInTheDocument();
  });

  it("calls onClose when close tab button or back button is clicked", () => {
    const onClose = vi.fn();
    render(<SubagentDetailViewer subagent={mockSubagent} onClose={onClose} />);

    const closeBtn = screen.getByLabelText("关闭标签");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders failed status badge when subagent failed", () => {
    const failedSubagent: SubagentSession = {
      ...mockSubagent,
      status: "failed",
    };
    render(<SubagentDetailViewer subagent={failedSubagent} onClose={vi.fn()} />);
    expect(screen.getByText("执行失败")).toBeInTheDocument();
  });
});
