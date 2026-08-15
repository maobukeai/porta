import { describe, it, expect } from "vitest";
import { exportChatToMarkdown, exportChatToHtml } from "../utils/exportChat";
import type { ChatMessage } from "../types";

describe("exportChat utils", () => {
  const sampleMessages: ChatMessage[] = [
    { type: "chat", stepIndex: 1, role: "user", content: "Hello AI" },
    { type: "chat", stepIndex: 2, role: "assistant", content: "Hello User!" },
  ];

  it("exports conversation to Markdown format", () => {
    const md = exportChatToMarkdown("Test Chat", sampleMessages);
    expect(md).toContain("# Test Chat");
    expect(md).toContain("### 👤 用户");
    expect(md).toContain("Hello AI");
    expect(md).toContain("### 🤖 Mcode AI");
    expect(md).toContain("Hello User!");
  });

  it("exports conversation to HTML format", () => {
    const html = exportChatToHtml("Test Chat", sampleMessages);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Test Chat</title>");
  });
});
