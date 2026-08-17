import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningTasksBar } from "../components/RunningTasksBar";
import type { RunningTask } from "../types";

describe("RunningTasksBar Component", () => {
  const mockTasks: RunningTask[] = [
    {
      id: "cmd-1",
      stepIndex: 0,
      command: "cargo run",
      displayCommand: "cargo run",
      status: "running",
      kind: "command",
      output: "Compiling...",
    },
  ];

  it("renders nothing when there are no running tasks", () => {
    const { container } = render(
      <RunningTasksBar runningTasks={[]} onOpenDrawer={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 1:1 '1 task running' label and command text with spinner", () => {
    render(
      <RunningTasksBar
        runningTasks={mockTasks}
        onOpenDrawer={vi.fn()}
        onTerminateTask={vi.fn()}
      />,
    );

    expect(screen.getByText("1 task running")).toBeTruthy();
    expect(screen.getByText("cargo run")).toBeTruthy();
  });

  it("calls onOpenDrawer when clicked", () => {
    const onOpen = vi.fn();
    render(
      <RunningTasksBar
        runningTasks={mockTasks}
        onOpenDrawer={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /1 task running/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("calls onTerminateTask when quick stop button is clicked", () => {
    const onTerminate = vi.fn();
    render(
      <RunningTasksBar
        runningTasks={mockTasks}
        onOpenDrawer={vi.fn()}
        onTerminateTask={onTerminate}
      />,
    );

    const stopBtn = screen.getByRole("button", { name: "终止当前后台任务" });
    fireEvent.click(stopBtn);
    expect(onTerminate).toHaveBeenCalledWith("cmd-1");
  });
});
