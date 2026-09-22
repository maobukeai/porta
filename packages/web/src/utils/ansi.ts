export interface AnsiSpan {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const STANDARD_FOREGROUNDS: Record<number, string> = {
  30: "#4b5563", // black
  31: "#ef4444", // red
  32: "#22c55e", // green
  33: "#eab308", // yellow
  34: "#3b82f6", // blue
  35: "#d946ef", // magenta
  36: "#06b6d4", // cyan
  37: "#f3f4f6", // white
  90: "#9ca3af", // bright black (gray)
  91: "#f87171", // bright red
  92: "#4ade80", // bright green
  93: "#fde047", // bright yellow
  94: "#60a5fa", // bright blue
  95: "#e879f9", // bright magenta
  96: "#22d3ee", // bright cyan
  97: "#ffffff", // bright white
};

const STANDARD_BACKGROUNDS: Record<number, string> = {
  40: "#1f2937",
  41: "#7f1d1d",
  42: "#14532d",
  43: "#713f12",
  44: "#1e3a8a",
  45: "#701a75",
  46: "#164e63",
  47: "#f3f4f6",
  100: "#374151",
  101: "#991b1b",
  102: "#166534",
  103: "#854d0e",
  104: "#1e40af",
  105: "#86198f",
  106: "#155e75",
  107: "#ffffff",
};

/** 256-color palette approximation */
function get256Color(n: number): string {
  if (n < 16) {
    if (n < 8) return STANDARD_FOREGROUNDS[30 + n] || "#888888";
    return STANDARD_FOREGROUNDS[90 + (n - 8)] || "#ffffff";
  }
  if (n >= 232) {
    // Grayscale ramp from 232 to 255
    const gray = Math.round(((n - 232) / 23) * 255);
    const hex = gray.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  }
  // 6x6x6 color cube
  const code = n - 16;
  const r = Math.floor(code / 36);
  const g = Math.floor((code % 36) / 6);
  const b = code % 6;
  const toVal = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  const rh = toVal(r).toString(16).padStart(2, "0");
  const gh = toVal(g).toString(16).padStart(2, "0");
  const bh = toVal(b).toString(16).padStart(2, "0");
  return `#${rh}${gh}${bh}`;
}

/**
 * Strips non-SGR ANSI sequences and unprintable control characters,
 * while preserving newlines and indentation.
 */
export function stripControlCharacters(text: string): string {
  if (!text) return "";
  // 1. Normalize carriage returns: \r\n -> \n, standalone \r -> \n
  let cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 2. Strip non-SGR escape sequences (e.g. cursor movement, terminal modes: ESC [ ... [A-Za-z] where not 'm')
  cleaned = cleaned.replace(/\u001b\[[0-9;?]*[A-LN-Za-ln-z]/g, "");
  // 3. Strip 2-char VT52 / VT100 escapes (e.g. character set ESC ( B, keypad ESC =, ESC 7/8, ESC c)
  cleaned = cleaned.replace(/\u001b[()#%*+][A-Za-z0-9]/g, "");
  cleaned = cleaned.replace(/\u001b[=>EFHMNP78c]/g, "");
  // 4. Strip OSC / DCS / other control sequences (ESC ] ... BEL/ST)
  cleaned = cleaned.replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "");
  // 5. Strip non-printable control chars except \n (\x0A), \t (\x09), and ESC (\x1B)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, "");
  return cleaned;
}

/**
 * Parses ANSI color and style escape sequences into styled spans.
 */
export function parseAnsi(rawText: string): AnsiSpan[] {
  if (!rawText) return [];

  const text = stripControlCharacters(rawText);
  const regex = /\u001b\[([0-9;]*)m/g;
  const spans: AnsiSpan[] = [];

  let currentColor: string | undefined;
  let currentBg: string | undefined;
  let isBold = false;
  let isDim = false;
  let isItalic = false;
  let isUnderline = false;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const chunk = text.slice(lastIndex, match.index).replace(/\u001b/g, "");
    if (chunk) {
      spans.push({
        text: chunk,
        color: currentColor,
        backgroundColor: currentBg,
        bold: isBold,
        dim: isDim,
        italic: isItalic,
        underline: isUnderline,
      });
    }

    // Process SGR codes
    const codeStr = match[1] || "0";
    const codes = codeStr.split(";").map((c) => parseInt(c || "0", 10));

    let i = 0;
    while (i < codes.length) {
      const code = codes[i];
      if (code === 0) {
        currentColor = undefined;
        currentBg = undefined;
        isBold = false;
        isDim = false;
        isItalic = false;
        isUnderline = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (code === 3) {
        isItalic = true;
      } else if (code === 4) {
        isUnderline = true;
      } else if (code === 22) {
        isBold = false;
        isDim = false;
      } else if (code === 23) {
        isItalic = false;
      } else if (code === 24) {
        isUnderline = false;
      } else if (code >= 30 && code <= 37) {
        currentColor = STANDARD_FOREGROUNDS[code];
      } else if (code === 39) {
        currentColor = undefined;
      } else if (code >= 40 && code <= 47) {
        currentBg = STANDARD_BACKGROUNDS[code];
      } else if (code === 49) {
        currentBg = undefined;
      } else if (code >= 90 && code <= 97) {
        currentColor = STANDARD_FOREGROUNDS[code];
      } else if (code >= 100 && code <= 107) {
        currentBg = STANDARD_BACKGROUNDS[code];
      } else if (code === 38) {
        // Extended foreground: 38;5;n or 38;2;r;g;b
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          currentColor = get256Color(codes[i + 2]);
          i += 2;
        } else if (
          codes[i + 1] === 2 &&
          codes[i + 2] !== undefined &&
          codes[i + 3] !== undefined &&
          codes[i + 4] !== undefined
        ) {
          currentColor = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
          i += 4;
        }
      } else if (code === 48) {
        // Extended background: 48;5;n or 48;2;r;g;b
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          currentBg = get256Color(codes[i + 2]);
          i += 2;
        } else if (
          codes[i + 1] === 2 &&
          codes[i + 2] !== undefined &&
          codes[i + 3] !== undefined &&
          codes[i + 4] !== undefined
        ) {
          currentBg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
          i += 4;
        }
      }
      i++;
    }

    lastIndex = regex.lastIndex;
  }

  // Trailing text after last ANSI code
  const remaining = text.slice(lastIndex).replace(/\u001b/g, "");
  if (remaining) {
    spans.push({
      text: remaining,
      color: currentColor,
      backgroundColor: currentBg,
      bold: isBold,
      dim: isDim,
      italic: isItalic,
      underline: isUnderline,
    });
  }

  return spans;
}
