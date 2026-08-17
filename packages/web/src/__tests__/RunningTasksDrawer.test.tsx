import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningTasksDrawer } from "../components/RunningTasksDrawer";
import type { RunningTask } from "../types";

describe("RunningTasksDrawer Component", () => {
  const mockTasks: RunningTask[] = [
    {
      id: "task-1",
      stepIndex: 0,
      command: "cargo run --example demo",
      displayCommand: "cargo run --example demo",
      status: "running",
      kind: "command",
      cwd: "/workspace/proj",
      output: "[INFO] Server started on port 8080\n",
    },
    {
      id: "task-2",
      stepIndex: 1,
      command: "npm test",
      displayCommand: "npm test",
      status: "completed",
      kind: "command",
      exitCode: 0,
      output: "All 10 tests passed\n",
    },
  ];

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <RunningTasksDrawer
        isOpen={false}
        onClose={vi.fn()}
        tasks={mockTasks}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders header, tabs, and tasks when isOpen is true", () => {
    render(
      <RunningTasksDrawer
        isOpen={true}
        onClose={vi.fn()}
        tasks={mockTasks}
      />,
    );

    expect(screen.getByText("后台任务管理")).toBeTruthy();
    expect(screen.getByText("正在运行 (1)")).toBeTruthy();
    expect(screen.getByText("全部任务 (2)")).toBeTruthy();
    expect(screen.getByText("cargo run --example demo")).toBeTruthy();
  });

  it("switches tabs and displays completed tasks", () => {
    render(
      <RunningTasksDrawer
        isOpen={true}
        onClose={vi.fn()}
        tasks={mockTasks}
      />,
    );

    const allTab = screen.getByText("全部任务 (2)");
    fireEvent.click(allTab);

    expect(screen.getByText("npm test")).toBeTruthy();
  });

  it("displays task output in the console pane", () => {
    render(
      <RunningTasksDrawer
        isOpen={true}
        onClose={vi.fn()}
        tasks={mockTasks}
      />,
    );

    expect(screen.getByText(/Server started on port 8080/)).toBeTruthy();
  });

  it("calls onTerminateTask when terminate button is clicked", () => {
    const onTerminate = vi.fn();
    render(
      <RunningTasksDrawer
        isOpen={true}
        onClose={vi.fn()}
        tasks={mockTasks}
        onTerminateTask={onTerminate}
      />,
    );

    const stopBtns = screen.getAllByRole("button", { name: /终止/i });
    fireEvent.click(stopBtns[0]);
    expect(onTerminate).toHaveBeenCalledWith("task-1");
  });
});
