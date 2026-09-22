import { describe, it, expect } from "vitest";
import { parseAnsi, stripControlCharacters } from "../utils/ansi";

describe("ANSI parser", () => {
  it("handles plain text without escape sequences", () => {
    const result = parseAnsi("Hello world");
    expect(result).toEqual([
      {
        text: "Hello world",
        color: undefined,
        backgroundColor: undefined,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
      },
    ]);
  });

  it("handles empty and falsy input", () => {
    expect(parseAnsi("")).toEqual([]);
  });

  it("parses single color escape sequence", () => {
    const result = parseAnsi("\u001b[31mError message\u001b[0m");
    expect(result.length).toBe(1);
    expect(result[0].text).toBe("Error message");
    expect(result[0].color).toBe("#ef4444");
    expect(result[0].bold).toBe(false);
  });

  it("parses bold and color combinations", () => {
    const result = parseAnsi("\u001b[1;32mSuccess\u001b[0m text");
    expect(result.length).toBe(2);
    expect(result[0].text).toBe("Success");
    expect(result[0].bold).toBe(true);
    expect(result[0].color).toBe("#22c55e");
    expect(result[1].text).toBe(" text");
    expect(result[1].bold).toBe(false);
    expect(result[1].color).toBeUndefined();
  });

  it("parses 256 colors", () => {
    const result = parseAnsi("\u001b[38;5;1mRed text\u001b[0m");
    expect(result.length).toBe(1);
    expect(result[0].text).toBe("Red text");
    expect(result[0].color).toBe("#ef4444");
  });

  it("parses RGB truecolor", () => {
    const result = parseAnsi("\u001b[38;2;100;150;200mTruecolor\u001b[0m");
    expect(result.length).toBe(1);
    expect(result[0].text).toBe("Truecolor");
    expect(result[0].color).toBe("rgb(100, 150, 200)");
  });

  it("strips non-SGR escape sequences like cursor movements and control characters", () => {
    const raw = "\u001b[2K\u001b[1GInstalling...\u001b[?25h\r\nDone!\x07";
    const cleaned = stripControlCharacters(raw);
    expect(cleaned).toBe("Installing...\nDone!");
  });

  it("strips VT100 character set and 2-char escape sequences without leaking into spans", () => {
    const raw = "\u001b(BHello \u001b[32mWorld\u001b[0m\u001b)0!";
    const result = parseAnsi(raw);
    expect(result.length).toBe(3);
    expect(result[0].text).toBe("Hello ");
    expect(result[1].text).toBe("World");
    expect(result[1].color).toBe("#22c55e");
    expect(result[2].text).toBe("!");
  });
});
