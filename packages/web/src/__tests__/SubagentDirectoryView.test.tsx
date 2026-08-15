import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubagentDirectoryView } from "../components/SubagentDirectoryView";
import type { SubagentSession } from "../hooks/useSubagentViewer";

describe("SubagentDirectoryView Component", () => {
  const mockSubagents: SubagentSession[] = [
    {
      id: "sub-1",
      stepIndex: 1,
      role: "修复单元测试缺陷",
      typeName: "self",
      prompt: "修复单元测试缺陷...",
      status: "completed",
      output: "--- ## 测试执行结果报告 ### Antigravity 后端状态 Antigravity (agy) 后端当前存在系统性故障",
      timestamp: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "sub-2",
      stepIndex: 2,
      role: "修复SQLite并发锁问题",
      typeName: "self",
      prompt: "修复SQLite并发锁问题...",
      status: "completed",
      output: "## 缺陷 #5 修复完成 -- SQLite 并发数据库锁问题 ### 问题诊断 Vitest 4 默认并行运行测试文件。",
      timestamp: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "sub-3",
      stepIndex: 3,
      role: "修复后端安全缺陷",
      typeName: "self",
      prompt: "修复后端安全缺陷...",
      status: "completed",
      output: "## 任务阻塞：Antigravity 后端基础设施完全宕机 ### 阻塞结论 Antigravity 后端服务当前完全不可用",
      timestamp: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  it("renders 1:1 matching elements from Screenshot 2", () => {
    render(<SubagentDirectoryView subagents={mockSubagents} onSelectSubagent={vi.fn()} />);

    // Main title
    expect(screen.getByText("子智能体目录")).toBeInTheDocument();

    // Section 1: 正在运行 · 0
    expect(screen.getByText("正在运行 · 0")).toBeInTheDocument();
    expect(screen.getByText("没有正在运行的子智能体")).toBeInTheDocument();

    // Section 2: 已结束 · 3
    expect(screen.getByText("已结束 · 3")).toBeInTheDocument();

    // Items
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
    expect(screen.getByText("修复SQLite并发锁问题")).toBeInTheDocument();
    expect(screen.getByText("修复后端安全缺陷")).toBeInTheDocument();

    expect(screen.getAllByText("已完成").length).toBe(3);
  });

  it("renders running subagents in 正在运行 section", () => {
    const mixedSubagents: SubagentSession[] = [
      {
        id: "sub-run",
        stepIndex: 4,
        role: "实时代码重构智能体",
        typeName: "builder",
        prompt: "Refactoring code...",
        status: "running",
      },
      ...mockSubagents,
    ];

    render(<SubagentDirectoryView subagents={mixedSubagents} onSelectSubagent={vi.fn()} />);

    expect(screen.getByText("正在运行 · 1")).toBeInTheDocument();
    expect(screen.getByText("实时代码重构智能体")).toBeInTheDocument();
    expect(screen.queryByText("没有正在运行的子智能体")).not.toBeInTheDocument();
  });

  it("triggers onSelectSubagent when an item is clicked", () => {
    const onSelect = vi.fn();
    render(<SubagentDirectoryView subagents={mockSubagents} onSelectSubagent={onSelect} />);

    fireEvent.click(screen.getByText("修复SQLite并发锁问题"));
    expect(onSelect).toHaveBeenCalledWith("sub-2");
  });
});
