import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanProgressCard, PlanProgressCapsule } from "../components/PlanProgressCard";
import type { PlanProgressData } from "../hooks/usePlanTracker";

describe("PlanProgressCard Component", () => {
  const mockPlanData: PlanProgressData = {
    hasPlan: true,
    conversationId: "test-conv-123",
    title: "测试任务规划",
    total: 7,
    completedCount: 1,
    completedSteps: [
      { id: "task-1", index: 1, title: "后端基础架构搭建", icon: "🔧", status: "completed", rawText: "..." },
    ],
    currentStep: {
      id: "task-2",
      index: 2,
      title: "后端Bug修复: reorderTask逻辑 + 限流中间件",
      icon: "🔧",
      status: "running",
      rawText: "...",
    },
    upcomingSteps: [
      { id: "task-3", index: 3, title: "后端Vitest测试套件: 25+测试覆盖所有服务", icon: "🧪", status: "pending", rawText: "..." },
      { id: "task-4", index: 4, title: "通知提醒系统 (后端+前端)", icon: "🔔", status: "pending", rawText: "..." },
    ],
    overflowSteps: [
      { id: "task-5", index: 5, title: "附件支持系统 (后端+前端)", icon: "📎", status: "pending", rawText: "..." },
      { id: "task-6", index: 6, title: "日历视图系统 (后端+前端)", icon: "📅", status: "pending", rawText: "..." },
      { id: "task-7", index: 7, title: "前端打磨: 骨架屏+防抖节流+错误 Toast", icon: "💎", status: "pending", rawText: "..." },
    ],
    tasks: [],
    subagents: { total: 0, completed: 0, active: 0 },
    content: "# 完整规划 Markdown 内容",
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  };

  it("does not render when hasPlan is false, tasks empty and subagents empty", () => {
    const emptyData: PlanProgressData = {
      ...mockPlanData,
      hasPlan: false,
      total: 0,
      subagents: { total: 0, completed: 0, active: 0 },
    };
    const { container } = render(<PlanProgressCard planData={emptyData} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders tasks correctly when only tasks exist", () => {
    render(<PlanProgressCard planData={mockPlanData} />);

    // Header ratio
    expect(screen.getByText("进程")).toBeInTheDocument();
    expect(screen.getByText("1/7")).toBeInTheDocument();

    // Completed summary toggle
    expect(screen.getByText("已完成 1 项")).toBeInTheDocument();

    // Running task
    expect(screen.getByText("后端Bug修复: reorderTask逻辑 + 限流中间件")).toBeInTheDocument();

    // Upcoming tasks
    expect(screen.getByText("后端Vitest测试套件: 25+测试覆盖所有服务")).toBeInTheDocument();
    expect(screen.getByText("通知提醒系统 (后端+前端)")).toBeInTheDocument();

    // Overflow toggle
    expect(screen.getByText("待处理 3 项")).toBeInTheDocument();
  });

  it("toggles completed tasks list when accordion button is clicked", () => {
    render(<PlanProgressCard planData={mockPlanData} />);

    expect(screen.queryByText("后端基础架构搭建")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText("已完成 1 项"));
    expect(screen.getByText("后端基础架构搭建")).toBeInTheDocument();
  });

  it("toggles pending overflow popover balloon when clicking 待处理 3 项", () => {
    render(<PlanProgressCard planData={mockPlanData} />);

    expect(screen.queryByText("日历视图系统 (后端+前端)")).not.toBeInTheDocument();

    // Click overflow toggle
    fireEvent.click(screen.getByText("待处理 3 项"));
    expect(screen.getByText("日历视图系统 (后端+前端)")).toBeInTheDocument();
    expect(screen.getByText("附件支持系统 (后端+前端)")).toBeInTheDocument();
    expect(screen.getByText("前端打磨: 骨架屏+防抖节流+错误 Toast")).toBeInTheDocument();
  });

  it("calls onOpenPlanDetail when expand button is clicked", () => {
    const onOpenPlanDetail = vi.fn();
    render(<PlanProgressCard planData={mockPlanData} onOpenPlanDetail={onOpenPlanDetail} />);

    const expandBtn = screen.getByTitle("查看完整规划文档");
    fireEvent.click(expandBtn);
    expect(onOpenPlanDetail).toHaveBeenCalled();
  });

  it("renders PlanProgressCapsule correctly", () => {
    const onClick = vi.fn();
    render(<PlanProgressCapsule planData={mockPlanData} onClick={onClick} />);

    expect(screen.getByText("1/7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders unified Task + Subagent Nodes layout when both tasks and subagents exist", () => {
    const bothData: PlanProgressData = {
      ...mockPlanData,
      subagents: { total: 2, completed: 2, active: 0 },
    };

    const mockSubagents = [
      { id: "sub-1", stepIndex: 1, role: "修复单元测试缺陷", typeName: "self", prompt: "...", status: "completed" as const },
      { id: "sub-2", stepIndex: 2, role: "修复SQLite并发锁问题", typeName: "self", prompt: "...", status: "completed" as const },
    ];

    const onOpenSubagents = vi.fn();

    render(
      <PlanProgressCard
        planData={bothData}
        subagentSessions={mockSubagents}
        onOpenSubagents={onOpenSubagents}
      />
    );

    // Header
    expect(screen.getByText("任务与智能体")).toBeInTheDocument();
    expect(screen.getByText("1/7 · 🤖2/2")).toBeInTheDocument();

    // Top: Task items
    expect(screen.getByText("后端Bug修复: reorderTask逻辑 + 限流中间件")).toBeInTheDocument();

    // Bottom: Subagent items directly visible
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
    expect(screen.getByText("修复SQLite并发锁问题")).toBeInTheDocument();

    // Bottom directory button
    expect(screen.getByText("子智能体目录")).toBeInTheDocument();
    fireEvent.click(screen.getByText("子智能体目录"));
    expect(onOpenSubagents).toHaveBeenCalled();
  });

  it("renders directly in card body when there are only subagents (e.g. 1f6db4aa)", () => {
    const subagentsOnlyPlan: PlanProgressData = {
      ...mockPlanData,
      hasPlan: false,
      total: 0,
      completedCount: 0,
      completedSteps: [],
      currentStep: null,
      upcomingSteps: [],
      overflowSteps: [],
      subagents: { total: 2, completed: 2, active: 0 },
    };

    const mockSubagents = [
      { id: "sub-1", stepIndex: 1, role: "Usage Statistics Auditor", typeName: "self", prompt: "...", status: "completed" as const },
      { id: "sub-2", stepIndex: 2, role: "SidePanel & Subagent Viewer Auditor", typeName: "self", prompt: "...", status: "completed" as const },
    ];

    const onSelectSubagent = vi.fn();

    render(
      <PlanProgressCard
        planData={subagentsOnlyPlan}
        subagentSessions={mockSubagents}
        onSelectSubagent={onSelectSubagent}
      />
    );

    expect(screen.getByText("智能体")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();

    // The subagents and their roles are directly visible
    expect(screen.getByText("Usage Statistics Auditor")).toBeInTheDocument();
    expect(screen.getByText("SidePanel & Subagent Viewer Auditor")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBe(2);

    fireEvent.click(screen.getByText("Usage Statistics Auditor"));
    expect(onSelectSubagent).toHaveBeenCalledWith("sub-1");
  });

  it("renders running subagent with active tag and triggers onSelectSubagent", () => {
    const onSelectSubagent = vi.fn();
    const mockSubagents = [
      { id: "sub-run", stepIndex: 1, role: "Active Refactoring Agent", typeName: "builder", prompt: "...", status: "running" as const },
    ];

    const runningPlan: PlanProgressData = {
      ...mockPlanData,
      subagents: { total: 1, completed: 0, active: 1 },
    };

    render(
      <PlanProgressCard
        planData={runningPlan}
        subagentSessions={mockSubagents}
        onSelectSubagent={onSelectSubagent}
      />
    );

    expect(screen.getByText("Active Refactoring Agent")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Active Refactoring Agent"));
    expect(onSelectSubagent).toHaveBeenCalledWith("sub-run");
  });
});
