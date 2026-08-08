import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageActionSheet } from "../components/MessageActionSheet";

describe("MessageActionSheet", () => {
  it("renders correctly when open", () => {
    render(
      <MessageActionSheet
        open={true}
        onClose={vi.fn()}
        messageText="Hello world"
        isUserMessage={false}
      />,
    );

    expect(screen.getByText("复制消息文本")).toBeInTheDocument();
    expect(screen.getByText("语音朗读消息")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <MessageActionSheet
        open={false}
        onClose={vi.fn()}
        messageText="Hello world"
        isUserMessage={false}
      />,
    );

    expect(screen.queryByText("复制消息文本")).not.toBeInTheDocument();
  });

  it("calls onQuote when quote button is clicked", () => {
    const onQuote = vi.fn();
    const onClose = vi.fn();
    render(
      <MessageActionSheet
        open={true}
        onClose={onClose}
        messageText="Hello world"
        isUserMessage={false}
        onQuote={onQuote}
      />,
    );

    fireEvent.click(screen.getByText("引用为提示词"));
    expect(onQuote).toHaveBeenCalledWith("Hello world");
    expect(onClose).toHaveBeenCalled();
  });
});
