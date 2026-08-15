import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatHeader } from "../components/ChatHeader";

describe("ChatHeader Conversation Options Menu", () => {
  it("renders three dots button and opens options dropdown with Chinese actions", () => {
    const onTogglePin = vi.fn();
    const onToggleArchive = vi.fn();

    render(
      <ChatHeader
        title="Logo 文字与内容修改"
        projectName="antigravity移动端"
        conversationId="conv-123"
        onTogglePin={onTogglePin}
        onToggleArchive={onToggleArchive}
      />
    );

    const dotsBtn = screen.getByTitle("对话选项");
    expect(dotsBtn).toBeInTheDocument();

    fireEvent.click(dotsBtn);

    expect(screen.getByText("重命名")).toBeInTheDocument();
    expect(screen.getByText("置顶")).toBeInTheDocument();
    expect(screen.getByText("归档")).toBeInTheDocument();
    expect(screen.getByText("复制")).toBeInTheDocument();
  });

  it("handles copy submenu with conversation name, id, and project name", () => {
    render(
      <ChatHeader
        title="Logo 文字与内容修改"
        projectName="antigravity移动端"
        conversationId="conv-123"
      />
    );

    const dotsBtn = screen.getByTitle("对话选项");
    fireEvent.click(dotsBtn);

    const copyItem = screen.getByText("复制");
    fireEvent.click(copyItem);

    expect(screen.getByText("复制对话名称")).toBeInTheDocument();
    expect(screen.getByText("复制对话 ID")).toBeInTheDocument();
    expect(screen.getByText("复制项目名称")).toBeInTheDocument();
  });

  it("opens rename modal and invokes onRename", () => {
    const onRename = vi.fn();
    render(
      <ChatHeader
        title="Logo 文字与内容修改"
        projectName="antigravity移动端"
        conversationId="conv-123"
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByTitle("对话选项"));
    fireEvent.click(screen.getByText("重命名"));

    expect(screen.getByText("重命名任务")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("任务名称") as HTMLInputElement;
    expect(input.value).toBe("Logo 文字与内容修改");

    fireEvent.change(input, { target: { value: "新名称" } });
    fireEvent.click(screen.getByText("确认"));

    expect(onRename).toHaveBeenCalledWith("conv-123", "新名称");
  });

  it("opens delete confirm modal and invokes onDelete", () => {
    const onDelete = vi.fn();
    render(
      <ChatHeader
        title="Logo 文字与内容修改"
        projectName="antigravity移动端"
        conversationId="conv-123"
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTitle("对话选项"));
    fireEvent.click(screen.getByText("删除对话"));

    expect(screen.getByText("确定要删除对话 \"Logo 文字与内容修改\" 吗？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(onDelete).toHaveBeenCalledWith("conv-123");
  });
});
