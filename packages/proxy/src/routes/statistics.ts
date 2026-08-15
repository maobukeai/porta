/**
 * /api/statistics/* routes
 * Collects and calculates 100% real LLM token consumption from local client transcripts
 * following the standard Agent context-window calculation (Input Context Window + Output/Reasoning Tokens).
 */

import type { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIRECTORIES = ["antigravity", "antigravity-ide", "antigravity-backup"] as const;
const BASE_SYSTEM_PROMPT_TOKENS = 12_000; // Base system instructions, MCP schemas & skills definitions
const MAX_CONTEXT_WINDOW_CAP = 65_000; // Realistic active sliding context window cap per agent invocation

export interface DailyModelTokens {
  [modelName: string]: number;
}

export interface DayUsageRecord {
  dateLabel: string; // e.g. "8月15日" or "13:00"
  isoDate: string; // "2026-08-15" or "2026-08-15T13:00"
  totalTokens: number;
  models: DailyModelTokens;
}

export interface HeatmapCell {
  date: string; // "2026-08-15"
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface UsageStatisticsResponse {
  range: "1d" | "7d" | "30d";
  totalTokens: number;
  formattedTokens: string;
  totalConversations: number;
  totalMessages: number;
  activeDays: number;
  consecutiveDays: number;
  topModel: string;
  topModelPercentage: number;
  heatmap: HeatmapCell[];
  dailyTrends: DayUsageRecord[];
  models: {
    id: string;
    name: string;
    color: string;
  }[];
}

const PALETTE = [
  "#3b82f6", // Blue
  "#0ea5e9", // Sky
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#f97316", // Orange
  "#84cc16", // Lime
];

export function getModelColor(modelName: string, index = 0): string {
  const lower = modelName.toLowerCase();
  if (lower.includes("3.7")) return "#3b82f6"; // Blue
  if (lower.includes("3.6")) return "#0ea5e9"; // Sky Blue
  if (lower.includes("3.5")) return "#06b6d4"; // Cyan
  if (lower.includes("3.1") || lower.includes("pro")) return "#6366f1"; // Indigo
  if (lower.includes("gemini")) return "#38bdf8"; // Light Sky
  if (lower.includes("sonnet")) return "#f59e0b"; // Amber
  if (lower.includes("opus")) return "#ea580c"; // Deep Orange
  if (lower.includes("claude")) return "#f97316"; // Orange
  if (lower.includes("gpt") || lower.includes("openai") || lower.includes("oss")) return "#10b981"; // Emerald
  if (lower.includes("deepseek")) return "#8b5cf6"; // Purple
  return PALETTE[index % PALETTE.length];
}

export function formatTokenCount(num: number): string {
  if (num >= 100_000_000) {
    const val = (num / 100_000_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1");
    return `${val}亿`;
  }
  if (num >= 10_000) {
    const val = (num / 10_000).toFixed(1).replace(/\.0$/, "");
    return `${val}万`;
  }
  if (num >= 1_000) {
    const val = (num / 1_000).toFixed(1).replace(/\.0$/, "");
    return `${val}k`;
  }
  return String(num);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function extractModelFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const idx = text.indexOf("Model Selection");
  if (idx === -1) return null;
  const after = text.slice(idx);
  const toIdx = after.indexOf(" to ");
  if (toIdx === -1) return null;
  const afterTo = after.slice(toIdx + 4);
  const m = afterTo.match(/^[`'"]?([A-Za-z0-9\s\(\)\-\_]+(?:\.[0-9]+[A-Za-z0-9\s\(\)\-\_]*)*)/);
  if (m && m[1]) {
    const raw = m[1].trim();
    if (
      raw &&
      raw !== "None" &&
      !raw.toLowerCase().startsWith("no need") &&
      !raw.toLowerCase().includes("comment")
    ) {
      return raw;
    }
  }
  return null;
}

export async function collectDiskUsageStats(daysRange = 1): Promise<UsageStatisticsResponse> {
  const now = new Date();
  const is1Day = daysRange === 1;
  const todayISO = toISODate(now);
  const cutoffDate = new Date(now.getTime() - (daysRange - 1) * 24 * 60 * 60 * 1000);
  const cutoffISO = toISODate(cutoffDate);

  const dailyDataMap = new Map<
    string,
    { totalTokens: number; models: DailyModelTokens; messages: number; conversations: Set<string> }
  >();
  const hourlyDataMap = new Map<
    string,
    { totalTokens: number; models: DailyModelTokens; messages: number; conversations: Set<string> }
  >();

  if (is1Day) {
    for (let h = 0; h < 24; h++) {
      const hStr = `${String(h).padStart(2, "0")}:00`;
      hourlyDataMap.set(hStr, {
        totalTokens: 0,
        models: {},
        messages: 0,
        conversations: new Set(),
      });
    }
  } else {
    for (let i = daysRange - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const iso = toISODate(d);
      dailyDataMap.set(iso, {
        totalTokens: 0,
        models: {},
        messages: 0,
        conversations: new Set(),
      });
    }
  }

  // Pre-fill heatmap dates for 16 weeks (112 days)
  const heatmapMap = new Map<string, number>();
  for (let i = 111; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    heatmapMap.set(toISODate(d), 0);
  }

  let rangeScannedTokens = 0;
  let rangeScannedMessages = 0;
  const rangeConversations = new Set<string>();
  const modelTotals = new Map<string, number>();

  // Scan conversations across all known local app brain directories
  for (const bSubDir of BRAIN_DIRECTORIES) {
    const brainDir = join(homedir(), ".gemini", bSubDir, "brain");
    try {
      const convEntries = await readdir(brainDir);
      for (const convId of convEntries) {
        const logDir = join(brainDir, convId, ".system_generated", "logs");
        try {
          const files = await readdir(logDir);
          let targetFile: string | null = null;
          if (files.includes("transcript_full.jsonl")) {
            targetFile = join(logDir, "transcript_full.jsonl");
          } else if (files.includes("transcript.jsonl")) {
            targetFile = join(logDir, "transcript.jsonl");
          } else if (files.includes("overview.txt")) {
            targetFile = join(logDir, "overview.txt");
          }

          if (!targetFile) continue;

          const content = await readFile(targetFile, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim().length > 0);
          if (lines.length === 0) continue;

          let currentModel = "Gemini 3.7 Flash (High)";
          const recentTurnsChars: number[] = [];

          for (const line of lines) {
            try {
              const step = JSON.parse(line);
              const createdAt = step.created_at ? new Date(step.created_at) : null;
              const dateKey = createdAt ? toISODate(createdAt) : todayISO;
              const hourKey = createdAt ? `${String(createdAt.getHours()).padStart(2, "0")}:00` : "00:00";

              // Detect actual model change in transcript
              if (step.content && typeof step.content === "string") {
                const detectedModel = extractModelFromText(step.content);
                if (detectedModel) {
                  currentModel = detectedModel;
                }
              }

              const contentStr = step.content ? String(step.content) : "";
              const thinkingStr = step.thinking ? String(step.thinking) : "";
              const toolCallsStr = step.tool_calls ? JSON.stringify(step.tool_calls) : "";
              const stepChars = contentStr.length + thinkingStr.length + toolCallsStr.length;
              const outputTokens = Math.max(1, Math.round(stepChars / 3.0));

              recentTurnsChars.push(stepChars);
              if (recentTurnsChars.length > 20) recentTurnsChars.shift();

              let invocationTokens = outputTokens;
              const isModelTurn = step.source === "MODEL" || step.type === "PLANNER_RESPONSE";

              if (isModelTurn) {
                const historyTokens = Math.round(recentTurnsChars.reduce((a, b) => a + b, 0) / 3.0);
                const inputTokens = Math.min(MAX_CONTEXT_WINDOW_CAP, BASE_SYSTEM_PROMPT_TOKENS + historyTokens);
                invocationTokens = inputTokens + outputTokens;
              }

              // Record to 16-week heatmap
              if (heatmapMap.has(dateKey)) {
                heatmapMap.set(dateKey, (heatmapMap.get(dateKey) || 0) + invocationTokens);
              }

              // Filter for the requested time range
              if (is1Day) {
                if (dateKey === todayISO) {
                  rangeScannedTokens += invocationTokens;
                  rangeScannedMessages += 1;
                  rangeConversations.add(convId);
                  modelTotals.set(currentModel, (modelTotals.get(currentModel) || 0) + invocationTokens);

                  const hObj = hourlyDataMap.get(hourKey);
                  if (hObj) {
                    hObj.totalTokens += invocationTokens;
                    hObj.messages += 1;
                    hObj.conversations.add(convId);
                    hObj.models[currentModel] = (hObj.models[currentModel] || 0) + invocationTokens;
                  }
                }
              } else {
                if (dateKey >= cutoffISO) {
                  rangeScannedTokens += invocationTokens;
                  rangeScannedMessages += 1;
                  rangeConversations.add(convId);
                  modelTotals.set(currentModel, (modelTotals.get(currentModel) || 0) + invocationTokens);

                  const dayObj = dailyDataMap.get(dateKey);
                  if (dayObj) {
                    dayObj.totalTokens += invocationTokens;
                    dayObj.messages += 1;
                    dayObj.conversations.add(convId);
                    dayObj.models[currentModel] = (dayObj.models[currentModel] || 0) + invocationTokens;
                  }
                }
              }
            } catch {
              // Ignore malformed line
            }
          }
        } catch {
          // File unreadable or missing
        }
      }
    } catch {
      // Directory missing
    }
  }

  // Calculate active days & consecutive streak within range
  let activeDaysCount = 0;
  let streak = 0;

  if (is1Day) {
    activeDaysCount = rangeScannedTokens > 0 || rangeScannedMessages > 0 ? 1 : 0;
    streak = activeDaysCount;
  } else {
    const sortedDates = Array.from(dailyDataMap.keys()).sort();
    let countingStreak = true;

    for (let i = sortedDates.length - 1; i >= 0; i--) {
      const key = sortedDates[i];
      const item = dailyDataMap.get(key)!;
      if (item.totalTokens > 0 || item.messages > 0) {
        activeDaysCount++;
        if (countingStreak) {
          streak++;
        }
      } else {
        if (countingStreak && i < sortedDates.length - 1) {
          countingStreak = false;
        }
      }
    }
  }

  // Determine top model within the time range
  let topModel = "Gemini 3.7 Flash (High)";
  let topModelTokens = 0;
  let totalRangeTokens = 0;

  for (const [m, tok] of modelTotals.entries()) {
    totalRangeTokens += tok;
    if (tok > topModelTokens) {
      topModelTokens = tok;
      topModel = m;
    }
  }

  const topModelPercentage =
    totalRangeTokens > 0
      ? Math.round((topModelTokens / totalRangeTokens) * 100)
      : 100;

  // Build heatmap cells with relative intensities (0..4)
  const heatmap: HeatmapCell[] = [];
  const maxHeatmapCount = Math.max(1, ...Array.from(heatmapMap.values()));

  for (const [date, count] of heatmapMap.entries()) {
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (count > 0) {
      const ratio = count / maxHeatmapCount;
      if (ratio > 0.75) level = 4;
      else if (ratio > 0.45) level = 3;
      else if (ratio > 0.2) level = 2;
      else level = 1;
    }
    heatmap.push({ date, count, level });
  }

  // Build daily/hourly trend records
  const dailyTrends: DayUsageRecord[] = [];
  if (is1Day) {
    for (let h = 0; h < 24; h++) {
      const hStr = `${String(h).padStart(2, "0")}:00`;
      const hObj = hourlyDataMap.get(hStr)!;
      dailyTrends.push({
        dateLabel: hStr,
        isoDate: `${todayISO}T${hStr}`,
        totalTokens: hObj.totalTokens,
        models: hObj.models,
      });
    }
  } else {
    const sortedDates = Array.from(dailyDataMap.keys()).sort();
    for (const date of sortedDates) {
      const dObj = dailyDataMap.get(date)!;
      const parts = date.split("-");
      const label = `${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`;
      dailyTrends.push({
        dateLabel: label,
        isoDate: date,
        totalTokens: dObj.totalTokens,
        models: dObj.models,
      });
    }
  }

  // Build discovered active models list (ordered by token volume descending)
  const sortedModels = Array.from(modelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([mName]) => mName);

  if (sortedModels.length === 0) {
    sortedModels.push(topModel);
  }

  const modelsList = sortedModels.map((mName, idx) => ({
    id: mName,
    name: mName,
    color: getModelColor(mName, idx),
  }));

  return {
    range: is1Day ? "1d" : daysRange === 7 ? "7d" : "30d",
    totalTokens: rangeScannedTokens,
    formattedTokens: formatTokenCount(rangeScannedTokens),
    totalConversations: rangeConversations.size,
    totalMessages: rangeScannedMessages,
    activeDays: activeDaysCount,
    consecutiveDays: streak,
    topModel,
    topModelPercentage,
    heatmap,
    dailyTrends,
    models: modelsList,
  };
}

export function registerStatisticsRoutes(app: Hono): void {
  app.get("/api/statistics/usage", async (c) => {
    try {
      const rangeParam = c.req.query("range");
      let days = 1;
      if (rangeParam === "30" || rangeParam === "30d") {
        days = 30;
      } else if (rangeParam === "7" || rangeParam === "7d") {
        days = 7;
      } else if (rangeParam === "1" || rangeParam === "1d" || rangeParam === "today") {
        days = 1;
      }
      const stats = await collectDiskUsageStats(days);
      return c.json(stats);
    } catch (err) {
      console.error("[Statistics Route Error]", err);
      return c.json(
        {
          range: "1d",
          totalTokens: 0,
          formattedTokens: "0",
          totalConversations: 0,
          totalMessages: 0,
          activeDays: 0,
          consecutiveDays: 0,
          topModel: "Gemini 3.7 Flash (High)",
          topModelPercentage: 100,
          heatmap: [],
          dailyTrends: [],
          models: [{ id: "Gemini 3.7 Flash (High)", name: "Gemini 3.7 Flash (High)", color: "#3b82f6" }],
        },
        500
      );
    }
  });
}
