import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatInput } from "../components/ChatInput";

describe("ChatInput", () => {
  const mockOnSend = vi.fn();
  const mockOnStop = vi.fn();
  const mockOnDraftChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:mock"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(),
    });
  });

  const defaultProps = {
    onSend: mockOnSend,
    onStop: mockOnStop,
    onDraftChange: mockOnDraftChange,
    isRunning: false,
    draft: "",
  };

  it("renders correctly", () => {
    render(<ChatInput {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("提出后续修改要求，输入 @ 引用或 / 快捷指令..."),
    ).toBeInTheDocument();
  });

  it("calls onDraftChange when typing", async () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(
      "提出后续修改要求，输入 @ 引用或 / 快捷指令...",
    ) as HTMLTextAreaElement;
    // The textarea is now uncontrolled and uses a native DOM 'input' listener.
    // We must set the value on the DOM element and fire a native 'input' event.
    textarea.value = "hello";
    fireEvent.input(textarea);
    // onDraftChange is called inside a microtask (Promise.resolve().then(...))
    // so we wait for the next tick before asserting.
    await waitFor(() => {
      expect(mockOnDraftChange).toHaveBeenCalledWith("hello");
    });
  });

  it("blocks oversized svg attachments before sending", async () => {
    const { container } = render(<ChatInput {...defaultProps} />);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(
      [new Uint8Array(1024 * 1024 + 1)],
      "large.svg",
      { type: "image/svg+xml" },
    );

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByAltText("attachment")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("发送 (Enter)"));

    await waitFor(() => {
      expect(mockOnSend).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "GIF and SVG attachments must stay under",
      );
    });
  });
});

describe("ChatInput sent-history recall (↑)", () => {
  const mockOnSend = vi.fn();
  const mockOnDraftChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const props = {
    onSend: mockOnSend,
    onStop: vi.fn(),
    onDraftChange: mockOnDraftChange,
    isRunning: false,
    draft: "",
  };

  function setup() {
    render(<ChatInput {...props} />);
    return screen.getByPlaceholderText(
      "提出后续修改要求，输入 @ 引用或 / 快捷指令...",
    ) as HTMLTextAreaElement;
  }

  async function sendText(textarea: HTMLTextAreaElement, text: string) {
    textarea.value = text;
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => {
      expect(mockOnSend).toHaveBeenCalled();
    });
  }

  it("records sent messages and recalls the latest with ↑", async () => {
    const textarea = setup();
    await sendText(textarea, "帮我修复登录 Bug");
    expect(textarea.value).toBe("");

    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("帮我修复登录 Bug");
  });

  it("walks history with ↑↑ and returns to empty with ↓", async () => {
    const textarea = setup();
    await sendText(textarea, "第一条消息");
    await sendText(textarea, "第二条消息");

    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("第二条消息");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("第一条消息");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.value).toBe("第二条消息");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.value).toBe("");
  });

  it("deduplicates consecutive identical sends", async () => {
    const textarea = setup();
    await sendText(textarea, "重复消息");
    await sendText(textarea, "重复消息");

    const raw = localStorage.getItem("porta:inputHistory");
    const list = JSON.parse(raw as string);
    expect(list.filter((x: string) => x === "重复消息")).toHaveLength(1);
  });

  it("does not recall when the input already has text", async () => {
    const textarea = setup();
    await sendText(textarea, "历史消息");
    textarea.value = "正在打字";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // Non-empty input keeps native caret behaviour — value unchanged by recall
    expect(textarea.value).toBe("正在打字");
  });
});
