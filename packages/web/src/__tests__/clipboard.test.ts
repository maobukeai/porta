import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "../utils/clipboard";

describe("copyText clipboard utility", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    document.execCommand = originalExecCommand;
  });

  it("uses navigator.clipboard.writeText when available in secure contexts", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const success = await copyText("hello clipboard");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello clipboard");
  });

  it("falls back to document.execCommand when navigator.clipboard is undefined (e.g. HTTP LAN context)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const execMock = vi.fn().mockReturnValue(true);
    document.execCommand = execMock;

    const success = await copyText("fallback text for HTTP");
    expect(success).toBe(true);
    expect(execMock).toHaveBeenCalledWith("copy");
  });

  it("falls back to document.execCommand when navigator.clipboard.writeText throws", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const execMock = vi.fn().mockReturnValue(true);
    document.execCommand = execMock;

    const success = await copyText("text with permission error");
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("text with permission error");
    expect(execMock).toHaveBeenCalledWith("copy");
  });
});
