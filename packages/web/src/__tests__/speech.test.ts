import { describe, it, expect } from "vitest";
import { stripMarkdownForTTS } from "../utils/speech";

describe("stripMarkdownForTTS", () => {
  it("removes codeblocks and replaces with text marker", () => {
    const input = "Here is an explanation:\n```ts\nconst a = 123;\nconsole.log(a);\n```\nAnd more text.";
    const result = stripMarkdownForTTS(input);
    expect(result).not.toContain("const a = 123;");
    expect(result).toContain("Here is an explanation:");
    expect(result).toContain("[代码块已略过]");
    expect(result).toContain("And more text.");
  });

  it("strips headers, bold formatting, links, and HTML", () => {
    const input = "### Header 3\nThis is **bold** text with a [link](https://example.com) and <span>HTML</span>.";
    const result = stripMarkdownForTTS(input);
    expect(result).toBe("Header 3 This is bold text with a link and HTML.");
  });

  it("handles empty or whitespace string", () => {
    expect(stripMarkdownForTTS("")).toBe("");
    expect(stripMarkdownForTTS("   ")).toBe("");
  });
});
