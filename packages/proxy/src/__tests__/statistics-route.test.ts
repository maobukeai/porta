import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  registerStatisticsRoutes,
  formatTokenCount,
  extractModelFromText,
  getModelColor,
} from "../routes/statistics.js";

describe("Statistics Routes (/api/statistics/*)", () => {
  const app = new Hono();
  registerStatisticsRoutes(app);

  it("formatTokenCount formats token numbers in Chinese units", () => {
    expect(formatTokenCount(220000000)).toBe("2.2亿");
    expect(formatTokenCount(1542000)).toBe("154.2万");
    expect(formatTokenCount(3800)).toBe("3.8k");
    expect(formatTokenCount(500)).toBe("500");
  });

  it("GET /api/statistics/usage returns comprehensive metrics, heatmap and daily trends", async () => {
    const res = await app.request("/api/statistics/usage?range=30d");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.range).toBe("30d");
    expect(typeof data.totalTokens).toBe("number");
    expect(typeof data.formattedTokens).toBe("string");
    expect(typeof data.totalConversations).toBe("number");
    expect(typeof data.totalMessages).toBe("number");
    expect(typeof data.activeDays).toBe("number");
    expect(typeof data.consecutiveDays).toBe("number");
    expect(typeof data.topModel).toBe("string");
    expect(Array.isArray(data.heatmap)).toBe(true);
    expect(Array.isArray(data.dailyTrends)).toBe(true);
    expect(Array.isArray(data.models)).toBe(true);
  });

  it("GET /api/statistics/usage?range=7d returns 7-day statistics", async () => {
    const res = await app.request("/api/statistics/usage?range=7d");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.range).toBe("7d");
    expect(data.dailyTrends.length).toBe(7);
  });

  it("GET /api/statistics/usage without range defaults to 1d (当天)", async () => {
    const res = await app.request("/api/statistics/usage");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.range).toBe("1d");
    expect(data.dailyTrends.length).toBe(24);
  });

  it("extractModelFromText extracts valid model names and handles edge cases", () => {
    expect(extractModelFromText("Updated Model Selection to Gemini 3.7 Flash (High)")).toBe(
      "Gemini 3.7 Flash (High)"
    );
    expect(extractModelFromText("Model Selection to 'Claude 3.5 Sonnet' for code refactor")).toBe(
      "Claude 3.5 Sonnet"
    );
    expect(extractModelFromText("Model Selection to deepseek-r1")).toBe("deepseek-r1");
    expect(extractModelFromText("Model Selection to None")).toBeNull();
    expect(extractModelFromText("Model Selection to no need to switch")).toBeNull();
    expect(extractModelFromText("Model Selection to comment on code")).toBeNull();
    expect(extractModelFromText("")).toBeNull();
    expect(extractModelFromText(null as any)).toBeNull();
  });

  it("getModelColor returns designated colors for known model families", () => {
    expect(getModelColor("Gemini 3.7 Flash")).toBe("#3b82f6");
    expect(getModelColor("Claude 3.5 Sonnet")).toBe("#06b6d4");
    expect(getModelColor("Claude Sonnet 3.7")).toBe("#3b82f6");
    expect(getModelColor("Claude 3 Opus")).toBe("#ea580c");
    expect(getModelColor("gpt-4o")).toBe("#10b981");
    expect(getModelColor("deepseek-reasoner")).toBe("#8b5cf6");
  });

  it("GET /api/statistics/usage parses numeric and string range queries correctly", async () => {
    const res30 = await app.request("/api/statistics/usage?range=30");
    const data30 = await res30.json();
    expect(data30.range).toBe("30d");
    expect(data30.dailyTrends.length).toBe(30);

    const resToday = await app.request("/api/statistics/usage?range=today");
    const dataToday = await resToday.json();
    expect(dataToday.range).toBe("1d");
    expect(dataToday.dailyTrends.length).toBe(24);
  });
});
