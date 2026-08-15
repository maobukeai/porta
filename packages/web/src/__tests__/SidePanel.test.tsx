import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidePanel } from "../components/SidePanel";
import type { TrajectoryStep } from "../types";

describe("SidePanel Component", () => {
  it("renders tab picker empty state matching design with 3 cards", () => {
    render(<SidePanel steps={[]} messages={[]} />);
    expect(screen.getByText("打开标签页")).toBeInTheDocument();
    expect(screen.getByText("选择要在侧边面板中打开的标签。")).toBeInTheDocument();
    expect(screen.getByText("辅助对话")).toBeInTheDocument();
    expect(screen.getByText("审查")).toBeInTheDocument();
    expect(screen.getByText("终端")).toBeInTheDocument();
  });

  it("activates 审查 tab when clicking 审查 card and shows code review center", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_REPLACE_FILE_CONTENT",
        replaceFileContent: {
          targetFile: "src/App.tsx",
          replacementContent: "const sample = 123;",
        },
      },
    ];

    render(<SidePanel steps={mockSteps} messages={[]} />);
    const reviewCard = screen.getByText("审查");
    fireEvent.click(reviewCard);

    // Tab bar appears and review content shows Code Review Dashboard
    expect(screen.getByText("代码审查中心")).toBeInTheDocument();
    expect(screen.getByText("工作区代码变更")).toBeInTheDocument();
    expect(screen.getByText("const sample = 123;")).toBeInTheDocument();
  });

  it("activates Git 控制台 tab when initialTab is git and displays branch bar, commit actions, and history", () => {
    render(<SidePanel steps={[]} messages={[]} initialTab="git" />);
    expect(screen.getByText(/代码变更与 Git 控制台|代码变更与 GIT 控制台/i)).toBeInTheDocument();
    expect(screen.getByText("拉取")).toBeInTheDocument();
    expect(screen.getByText("推送")).toBeInTheDocument();
    expect(screen.getByText("提交并推送")).toBeInTheDocument();
    expect(screen.getByText("提交历史")).toBeInTheDocument();
    expect(screen.getByText("更改列表")).toBeInTheDocument();
  });

  it("activates 辅助对话 tab when clicking 辅助对话 card", () => {
    render(<SidePanel steps={[]} messages={[]} />);
    const chatCard = screen.getByText("辅助对话");
    fireEvent.click(chatCard);

    expect(
      screen.getByPlaceholderText(/输入辅助提问|输入辅助指令/i),
    ).toBeInTheDocument();
  });

  it("activates 终端 tab when clicking 终端 card and allows creating tabs", () => {
    render(<SidePanel steps={[]} messages={[]} projectName="测试项目" />);
    const terminalCard = screen.getByText("终端");
    fireEvent.click(terminalCard);

    expect(screen.getByTitle("新建终端")).toBeInTheDocument();
    expect(screen.getByTitle("切换面板")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked in empty state", () => {
    const onClose = vi.fn();
    render(<SidePanel steps={[]} messages={[]} onClose={onClose} />);
    const closeBtn = screen.getByTitle("关闭面板");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders formatted Markdown preview when opening a .md file and toggles between preview and code mode", async () => {
    const { api } = await import("../api/client");
    vi.spyOn(api, "readFileText").mockResolvedValue({
      path: "/workspace/walkthrough.md",
      content: "# 任务总结\n\n- 完成特性 1\n- 完成特性 2\n\n```ts\nconst x = 1;\n```",
    });

    render(
      <SidePanel
        steps={[]}
        messages={[]}
        initialTab="review"
        selectedFile={{
          name: "walkthrough.md",
          path: "/workspace/walkthrough.md",
          ext: "md",
        }}
      />,
    );

    // Should render the rendered markdown heading and list
    expect(await screen.findByText("任务总结")).toBeInTheDocument();
    expect(screen.getByText("完成特性 1")).toBeInTheDocument();
    expect(screen.getByText("完成特性 2")).toBeInTheDocument();

    // Has preview / source toggles
    const previewBtn = screen.getByTitle("预览渲染后的 Markdown 格式");
    const sourceBtn = screen.getByTitle("查看 Markdown 源码");
    expect(previewBtn).toBeInTheDocument();
    expect(sourceBtn).toBeInTheDocument();

    // Toggle to source mode
    fireEvent.click(sourceBtn);
    expect(await screen.findByText("# 任务总结")).toBeInTheDocument();

    // Toggle back to preview mode
    fireEvent.click(previewBtn);
    expect(await screen.findByText("完成特性 1")).toBeInTheDocument();
  });

  it("renders 子智能体目录 card in picker when subagents exist and opens SubagentDirectoryView", () => {
    const mockStepsWithSubagents: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "修复单元测试缺陷",
                  TypeName: "self",
                  Prompt: "Fix vitest bugs...",
                },
                {
                  Role: "修复SQLite并发锁问题",
                  TypeName: "self",
                  Prompt: "Fix SQLite locks...",
                },
              ],
            },
          },
        },
      },
    ];

    render(<SidePanel steps={mockStepsWithSubagents} messages={[]} />);
    expect(screen.getByText("子智能体目录 (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("子智能体目录 (2)"));
    expect(screen.getAllByText("子智能体目录").length).toBeGreaterThan(0);
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
    expect(screen.getByText("修复SQLite并发锁问题")).toBeInTheDocument();
  });

  it("shows subagents in editor tab dropdown search and allows switching", () => {
    const mockStepsWithSubagents: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "修复单元测试缺陷",
                  TypeName: "self",
                  Prompt: "Fix vitest bugs...",
                },
              ],
            },
          },
        },
      },
    ];

    render(<SidePanel steps={mockStepsWithSubagents} messages={[]} initialTab="review" />);
    const dropdownBtn = screen.getByTitle("搜索并切换标签页");
    fireEvent.click(dropdownBtn);

    expect(screen.getByText("子智能体 (1)")).toBeInTheDocument();
    expect(screen.getByText("打开子智能体目录 (1)")).toBeInTheDocument();
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
  });
});

