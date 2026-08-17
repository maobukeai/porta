import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatSearchOverlay } from "../components/ChatSearchOverlay";
import type { ChatMessage } from "../types";

const messages: ChatMessage[] = [
  { type: "chat", role: "user", content: "帮我分析远程端显示异常", stepIndex: 2 },
  { type: "chat", role: "assistant", content: "好的，开始排查异常问题", stepIndex: 3 },
  { type: "chat", role: "user", content: "继续优化性能", stepIndex: 5, optimisticId: "opt-1" },
  { type: "chat", role: "assistant", content: "性能已优化完成", stepIndex: 6 },
];

function setup(overrides: Partial<Parameters<typeof ChatSearchOverlay>[0]> = {}) {
  const onClose = vi.fn();
  const scrollRef = { current: document.createElement("div") };
  render(
    <ChatSearchOverlay
      open
      onClose={onClose}
      messages={messages}
      scrollRef={scrollRef}
      {...overrides}
    />,
  );
  return { onClose, scrollRef };
}

describe("ChatSearchOverlay", () => {
  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByPlaceholderText("在对话中查找…")).toBeNull();
  });

  it("finds matches case-insensitively and shows the count", () => {
    setup();
    const input = screen.getByPlaceholderText("在对话中查找…");
    fireEvent.change(input, { target: { value: "异常" } });
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows 0/0 for no matches", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText("在对话中查找…"), {
      target: { value: "zzz不存在zzz" },
    });
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("cycles matches with Enter and Shift+Enter", () => {
    setup();
    const input = screen.getByPlaceholderText("在对话中查找…");
    fireEvent.change(input, { target: { value: "异常" } });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // Wraps back to the first match
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // Shift+Enter goes backwards
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByPlaceholderText("在对话中查找…"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("flashes the matched message anchored by data-step-index", async () => {
    const { scrollRef } = setup();
    const target = document.createElement("div");
    target.setAttribute("data-step-index", "2");
    scrollRef.current.appendChild(target);
    const input = screen.getByPlaceholderText("在对话中查找…");
    fireEvent.change(input, { target: { value: "帮我分析" } });
    await waitFor(() => expect(target.classList.contains("search-flash")).toBe(true));
  });

  it("flashes optimistic messages via data-optimistic-id anchor", async () => {
    const { scrollRef } = setup();
    const target = document.createElement("div");
    target.setAttribute("data-optimistic-id", "opt-1");
    scrollRef.current.appendChild(target);
    fireEvent.change(screen.getByPlaceholderText("在对话中查找…"), {
      target: { value: "优化性能" },
    });
    await waitFor(() => expect(target.classList.contains("search-flash")).toBe(true));
  });
});
