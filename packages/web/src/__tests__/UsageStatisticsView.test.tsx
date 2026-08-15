import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UsageStatisticsView, formatTokenNumber } from "../components/UsageStatisticsView";
import { api } from "../api/client";
import type { UsageStatisticsResponse } from "../types";

vi.mock("../api/client", () => ({
  api: {
    statistics: {
      usage: vi.fn(),
    },
  },
}));

const mock1dData: UsageStatisticsResponse = {
  range: "1d",
  totalTokens: 154200,
  formattedTokens: "15.4万",
  totalConversations: 5,
  totalMessages: 48,
  activeDays: 1,
  consecutiveDays: 1,
  topModel: "Gemini 3.7 Flash (High)",
  topModelPercentage: 85,
  heatmap: [
    { date: "2026-08-14", count: 50000, level: 1 },
    { date: "2026-08-15", count: 154200, level: 4 },
  ],
  dailyTrends: [
    {
      dateLabel: "00:00",
      isoDate: "2026-08-15T00:00",
      totalTokens: 5000,
      models: { "Gemini 3.7 Flash (High)": 5000 },
    },
    {
      dateLabel: "12:00",
      isoDate: "2026-08-15T12:00",
      totalTokens: 149200,
      models: {
        "Gemini 3.7 Flash (High)": 120000,
        "Claude 3.5 Sonnet": 29200,
      },
    },
  ],
  models: [
    { id: "Gemini 3.7 Flash (High)", name: "Gemini 3.7 Flash (High)", color: "#3b82f6" },
    { id: "Claude 3.5 Sonnet", name: "Claude 3.5 Sonnet", color: "#06b6d4" },
  ],
};

const mock7dData: UsageStatisticsResponse = {
  range: "7d",
  totalTokens: 850000,
  formattedTokens: "85.0万",
  totalConversations: 12,
  totalMessages: 210,
  activeDays: 4,
  consecutiveDays: 2,
  topModel: "Gemini 3.7 Flash (High)",
  topModelPercentage: 70,
  heatmap: [
    { date: "2026-08-14", count: 50000, level: 1 },
    { date: "2026-08-15", count: 154200, level: 4 },
  ],
  dailyTrends: [
    {
      dateLabel: "8月14日",
      isoDate: "2026-08-14",
      totalTokens: 50000,
      models: { "Gemini 3.7 Flash (High)": 50000 },
    },
    {
      dateLabel: "8月15日",
      isoDate: "2026-08-15",
      totalTokens: 154200,
      models: {
        "Gemini 3.7 Flash (High)": 120000,
        "Claude 3.5 Sonnet": 34200,
      },
    },
  ],
  models: [
    { id: "Gemini 3.7 Flash (High)", name: "Gemini 3.7 Flash (High)", color: "#3b82f6" },
    { id: "Claude 3.5 Sonnet", name: "Claude 3.5 Sonnet", color: "#06b6d4" },
  ],
};

describe("UsageStatisticsView Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (api.statistics.usage as any).mockResolvedValue(mock1dData);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatTokenNumber formats number strings accurately", () => {
    expect(formatTokenNumber(150_000_000)).toBe("1.5亿");
    expect(formatTokenNumber(100_000_000)).toBe("1亿");
    expect(formatTokenNumber(25_400)).toBe("2.5万");
    expect(formatTokenNumber(3_800)).toBe("3.8k");
    expect(formatTokenNumber(650)).toBe("650");
    expect(formatTokenNumber(0)).toBe("0");
  });

  it("renders 6 metric cards, live badge, and daily trend chart for 1d default", async () => {
    render(<UsageStatisticsView />);

    // Fast-forward initial async promise resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("使用统计")).toBeInTheDocument();
    expect(screen.getByText("应用用量")).toBeInTheDocument();
    expect(screen.getByText("实时同步")).toBeInTheDocument();

    // 6 Metrics
    expect(screen.getByText("tokens 用量")).toBeInTheDocument();
    expect(screen.getByText("15.4万")).toBeInTheDocument();
    expect(screen.getByText("会话数量")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("消息数量")).toBeInTheDocument();
    expect(screen.getByText("48")).toBeInTheDocument();
    expect(screen.getByText("活跃天数")).toBeInTheDocument();
    expect(screen.getByText("当前连续天数")).toBeInTheDocument();
    expect(screen.getByText("最常用模型")).toBeInTheDocument();
    expect(screen.getByText("占比 85%")).toBeInTheDocument();

    // Chart header for 1d
    expect(screen.getByText("今日按小时 Token 趋势")).toBeInTheDocument();
  });

  it("switches time range between 当天, 最近 7 天, and 最近 30 天", async () => {
    (api.statistics.usage as any).mockResolvedValueOnce(mock1dData);
    render(<UsageStatisticsView />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.statistics.usage).toHaveBeenCalledWith("1d");

    // Switch to 7d
    (api.statistics.usage as any).mockResolvedValueOnce(mock7dData);
    const btn7d = screen.getByText("最近 7 天");
    await act(async () => {
      fireEvent.click(btn7d);
    });

    expect(api.statistics.usage).toHaveBeenCalledWith("7d");
    expect(screen.getByText("按天 Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("85.0万")).toBeInTheDocument();
    expect(screen.getByText("占比 70%")).toBeInTheDocument();

    // Switch to 30d
    const btn30d = screen.getByText("最近 30 天");
    await act(async () => {
      fireEvent.click(btn30d);
    });

    expect(api.statistics.usage).toHaveBeenCalledWith("30d");
  });

  it("triggers manual refresh on refresh button click", async () => {
    render(<UsageStatisticsView />);

    await act(async () => {
      await Promise.resolve();
    });

    const refreshBtn = screen.getByTitle("刷新统计数据");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(api.statistics.usage).toHaveBeenCalledTimes(2);
  });

  it("performs silent auto-refresh every 6 seconds", async () => {
    render(<UsageStatisticsView />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.statistics.usage).toHaveBeenCalledTimes(1);

    // Fast-forward 6 seconds
    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(api.statistics.usage).toHaveBeenCalledTimes(2);

    // Fast-forward another 6 seconds
    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(api.statistics.usage).toHaveBeenCalledTimes(3);
  });

  it("displays hover tooltips when interacting with heatmap cells and trend bars", async () => {
    render(<UsageStatisticsView />);

    await act(async () => {
      await Promise.resolve();
    });

    // Heatmap cell hover
    const activeCell = document.querySelector(".usage-heatmap-matrix .heatmap-cell.level-4");
    expect(activeCell).not.toBeNull();
    if (activeCell) {
      act(() => {
        fireEvent.mouseEnter(activeCell);
      });
      expect(screen.getByText("2026-08-15")).toBeInTheDocument();
      expect(screen.getByText(/15.4万 Tokens/)).toBeInTheDocument();

      act(() => {
        fireEvent.mouseLeave(activeCell);
      });
      expect(screen.queryByText(/15.4万 Tokens/)).not.toBeInTheDocument();
    }

    // Trend bar hover
    const barCols = document.querySelectorAll(".usage-trend-bar-col");
    if (barCols.length > 0) {
      act(() => {
        fireEvent.mouseEnter(barCols[barCols.length - 1]);
      });
      expect(screen.getByText("12:00")).toBeInTheDocument();
      expect(screen.getByText(/总计: 14.9万 Tokens/)).toBeInTheDocument();

      act(() => {
        fireEvent.mouseLeave(barCols[barCols.length - 1]);
      });
      expect(screen.queryByText(/总计: 14.9万 Tokens/)).not.toBeInTheDocument();
    }
  });
});
