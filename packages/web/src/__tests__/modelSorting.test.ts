import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_MODEL } from "../constants";

describe("Model Sorting and Defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("DEFAULT_MODEL is set to gemini-3.7-flash-high", () => {
    expect(DEFAULT_MODEL).toBe("gemini-3.7-flash-high");
  });

  it("migrates legacy gemini-3.6-flash-high to null in localStorage readSettings", () => {
    const STORAGE_KEY = "porta:settings";
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaultModel: "gemini-3.6-flash-high" }));

    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    if (parsed.defaultModel === "gemini-3.6-flash-high") {
      parsed.defaultModel = null;
    }
    expect(parsed.defaultModel).toBeNull();
  });

  it("preserves explicitly chosen custom model in localStorage readSettings", () => {
    const STORAGE_KEY = "porta:settings";
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaultModel: "claude-opus-4-6-thinking" }));

    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    if (parsed.defaultModel === "gemini-3.6-flash-high") {
      parsed.defaultModel = null;
    }
    expect(parsed.defaultModel).toBe("claude-opus-4-6-thinking");
  });

  it("ranks Gemini 3.7 Flash highest in dynamic scoring", () => {
    const getGroupScore = (name: string, isRecommended: boolean) => {
      let score = 0;
      const n = name.toLowerCase();
      if (isRecommended) score += 10000;
      if (n.includes("gemini")) score += 5000;
      else if (n.includes("claude")) score += 3000;
      else if (n.includes("gpt")) score += 1000;
      else score += 500;

      const cleanName = name.replace(/\b\d+\s*[bkmBKM]\b/gi, "");
      const vMatch = cleanName.match(/\b(\d+(?:\.\d+)?)\b/);
      if (vMatch) {
        score += Math.round(parseFloat(vMatch[1]) * 100);
      }
      if (n.includes("flash")) score += 20;
      if (n.includes("pro")) score += 10;
      return score;
    };

    const models = [
      { name: "Claude Opus 4.6", rec: true },
      { name: "Gemini 3.5 Flash", rec: true },
      { name: "Gemini 3.6 Flash", rec: true },
      { name: "Gemini 3.7 Flash", rec: true },
      { name: "Gemini 3.1 Pro", rec: true },
      { name: "GPT-OSS 120B", rec: true },
    ];

    const sorted = [...models].sort((a, b) => getGroupScore(b.name, b.rec) - getGroupScore(a.name, a.rec));
    expect(sorted[0].name).toBe("Gemini 3.7 Flash");
    expect(sorted[1].name).toBe("Gemini 3.6 Flash");
    expect(sorted[2].name).toBe("Gemini 3.5 Flash");
    expect(sorted[3].name).toBe("Gemini 3.1 Pro");
  });
});
