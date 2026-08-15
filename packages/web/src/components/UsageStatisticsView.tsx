import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import {
  IconFlame,
  IconCalendar,
  IconActivityPulse,
  IconMessageSquare,
  IconRefresh,
  IconSpinner,
} from "./Icons";
import type { UsageStatisticsResponse, HeatmapCell, DayUsageRecord } from "../types";

export function formatTokenNumber(num: number): string {
  if (!num || num <= 0) return "0";
  if (num >= 100_000_000) {
    const val = (num / 100_000_000).toFixed(1).replace(/\.0$/, "");
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

export function UsageStatisticsView() {
  const [range, setRange] = useState<"1d" | "7d" | "30d">("1d");
  const [data, setData] = useState<UsageStatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredHeatmap, setHoveredHeatmap] = useState<HeatmapCell | null>(null);
  const [hoveredBar, setHoveredBar] = useState<{ day: DayUsageRecord; x: number; y: number } | null>(null);

  const fetchStats = useCallback(async (r: "1d" | "7d" | "30d", showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await api.statistics?.usage(r);
      if (res) setData(res);
    } catch (err) {
      console.error("Failed to load usage statistics:", err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(range, true);
    // Background auto-refresh every 6 seconds to reflect real-time activity
    const interval = setInterval(() => {
      void fetchStats(range, false);
    }, 6000);
    return () => clearInterval(interval);
  }, [range, fetchStats]);

  // Group heatmap cells into weeks (columns of 7 days)
  const heatmapWeeks = useMemo(() => {
    if (!data?.heatmap || data.heatmap.length === 0) return [];
    const weeks: HeatmapCell[][] = [];
    let currentWeek: HeatmapCell[] = [];

    for (let i = 0; i < data.heatmap.length; i++) {
      currentWeek.push(data.heatmap[i]);
      if (currentWeek.length === 7 || i === data.heatmap.length - 1) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    return weeks;
  }, [data?.heatmap]);

  // Find max daily tokens for proportional bar heights
  const maxDayTokens = useMemo(() => {
    if (!data?.dailyTrends || data.dailyTrends.length === 0) return 1;
    const max = Math.max(...data.dailyTrends.map((d) => d.totalTokens));
    return max > 0 ? max : 1;
  }, [data?.dailyTrends]);

  // Helper to get color for a model
  const getModelColor = useCallback(
    (modelName: string) => {
      const found = data?.models.find(
        (m) => m.name.toLowerCase() === modelName.toLowerCase() || m.id.toLowerCase() === modelName.toLowerCase()
      );
      if (found) return found.color;
      const lower = modelName.toLowerCase();
      if (lower.includes("3.7")) return "#3b82f6";
      if (lower.includes("3.6")) return "#0ea5e9";
      if (lower.includes("3.5")) return "#06b6d4";
      if (lower.includes("3.1") || lower.includes("pro")) return "#6366f1";
      if (lower.includes("gemini")) return "#38bdf8";
      if (lower.includes("sonnet")) return "#f59e0b";
      if (lower.includes("opus")) return "#ea580c";
      if (lower.includes("claude")) return "#f97316";
      if (lower.includes("gpt") || lower.includes("oss")) return "#10b981";
      if (lower.includes("deepseek")) return "#8b5cf6";
      return "#3b82f6";
    },
    [data?.models],
  );

  // Compute evenly spaced X-axis date/time labels for the trend chart
  const xAxisLabels = useMemo(() => {
    if (!data?.dailyTrends || data.dailyTrends.length === 0) return [];
    const trends = data.dailyTrends;
    if (range === "1d") {
      const hourPicks = [0, 4, 8, 12, 16, 20, 23];
      return hourPicks
        .filter((h) => h < trends.length)
        .map((h) => ({ label: trends[h].dateLabel, index: h }));
    }
    if (trends.length <= 7) {
      return trends.map((t, idx) => ({ label: t.dateLabel, index: idx }));
    }
    const count = 6;
    const step = (trends.length - 1) / (count - 1);
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(trends.length - 1, Math.round(i * step));
      result.push({ label: trends[idx].dateLabel, index: idx });
    }
    return result;
  }, [data?.dailyTrends, range]);

  return (
    <div className="usage-stats-container">
      {/* ── Top Header ── */}
      <div className="usage-stats-header">
        <div className="usage-stats-title-group">
          <h1 className="usage-stats-main-title">使用统计</h1>
          <div className="usage-stats-tab-pill">
            <span>应用用量</span>
            <div className="usage-stats-tab-underline" />
          </div>
          <div className="usage-live-badge" title="已开启实时监听，产生新对话或 Token 时自动更新">
            <span className="usage-live-dot" />
            <span>实时同步</span>
          </div>
        </div>

        <div className="usage-stats-controls">
          <div className="usage-stats-range-wrap">
            <span className="usage-stats-range-label">时间范围</span>
            <div className="usage-stats-segmented-control">
              <button
                type="button"
                className={`usage-stats-segment-btn ${range === "1d" ? "active" : ""}`}
                onClick={() => setRange("1d")}
              >
                当天
              </button>
              <button
                type="button"
                className={`usage-stats-segment-btn ${range === "7d" ? "active" : ""}`}
                onClick={() => setRange("7d")}
              >
                最近 7 天
              </button>
              <button
                type="button"
                className={`usage-stats-segment-btn ${range === "30d" ? "active" : ""}`}
                onClick={() => setRange("30d")}
              >
                最近 30 天
              </button>
            </div>
          </div>

          <button
            type="button"
            className="usage-stats-refresh-btn"
            onClick={() => fetchStats(range)}
            title="刷新统计数据"
            disabled={loading}
          >
            <IconRefresh size={14} className={loading ? "icon-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="usage-stats-loading">
          <IconSpinner size={24} className="icon-spin" />
          <span>正在计算与汇总使用数据…</span>
        </div>
      ) : (
        <div className="usage-stats-content">
          {/* ── 6 Metric Cards Grid (2 rows x 3 columns) ── */}
          <div className="usage-metrics-grid">
            {/* 1. tokens 用量 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconFlame size={14} />
                </span>
                <span className="usage-metric-label">tokens 用量</span>
              </div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-large-value">
                  {data?.formattedTokens || "0"}
                </span>
              </div>
            </div>

            {/* 2. 会话数量 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconMessageSquare size={14} />
                </span>
                <span className="usage-metric-label">会话数量</span>
              </div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-large-value">
                  {data?.totalConversations ?? 0}
                </span>
              </div>
            </div>

            {/* 3. 消息数量 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconMessageSquare size={14} />
                </span>
                <span className="usage-metric-label">消息数量</span>
              </div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-large-value">
                  {data?.totalMessages ?? 0}
                </span>
              </div>
            </div>

            {/* 4. 活跃天数 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconCalendar size={14} />
                </span>
                <span className="usage-metric-label">活跃天数</span>
              </div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-large-value">
                  {data?.activeDays ?? 0}
                </span>
              </div>
            </div>

            {/* 5. 当前连续天数 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconCalendar size={14} />
                </span>
                <span className="usage-metric-label">当前连续天数</span>
              </div>
              <div className="usage-metric-value-row">
                <span className="usage-metric-large-value">
                  {data?.consecutiveDays ?? 0}
                </span>
              </div>
            </div>

            {/* 6. 最常用模型 */}
            <div className="usage-metric-card">
              <div className="usage-metric-header">
                <span className="usage-metric-icon">
                  <IconActivityPulse size={14} />
                </span>
                <span className="usage-metric-label">最常用模型</span>
              </div>
              <div className="usage-metric-value-row model-col">
                <span className="usage-metric-model-name" title={data?.topModel}>
                  {data?.topModel || "-"}
                </span>
                <span className="usage-metric-subtext">
                  占比 {data?.topModelPercentage ?? 0}%
                </span>
              </div>
            </div>
          </div>

          {/* ── Section: 活跃热力图 ── */}
          <div className="usage-section-card">
            <div className="usage-section-header">
              <span className="usage-section-title">活跃热力图</span>
              <div className="usage-heatmap-legend">
                <span className="usage-legend-text">较少</span>
                <span className="heatmap-cell level-0" />
                <span className="heatmap-cell level-1" />
                <span className="heatmap-cell level-2" />
                <span className="heatmap-cell level-3" />
                <span className="heatmap-cell level-4" />
                <span className="usage-legend-text">较多</span>
              </div>
            </div>

            <div className="usage-heatmap-container">
              <div className="usage-heatmap-matrix">
                {heatmapWeeks.map((week, wIdx) => (
                  <div key={wIdx} className="usage-heatmap-col">
                    {week.map((cell, cIdx) => (
                      <div
                        key={cIdx}
                        className={`heatmap-cell level-${cell.level}`}
                        onMouseEnter={() => setHoveredHeatmap(cell)}
                        onMouseLeave={() => setHoveredHeatmap(null)}
                        title={`${cell.date}: ${formatTokenNumber(cell.count)} Tokens (${cell.count.toLocaleString()})`}
                      />
                    ))}
                  </div>
                ))}
              </div>

              {hoveredHeatmap && (
                <div className="usage-heatmap-tooltip">
                  <span className="tooltip-date">{hoveredHeatmap.date}</span>
                  <span className="tooltip-tokens">
                    {formatTokenNumber(hoveredHeatmap.count)} Tokens
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Section: 按天 / 按小时 Token 趋势 ── */}
          <div className="usage-section-card">
            <div className="usage-section-header">
              <span className="usage-section-title">
                {range === "1d" ? "今日按小时 Token 趋势" : "按天 Token 趋势"}
              </span>
            </div>

            <div className="usage-trend-chart-wrap">
              {/* Grid Lines */}
              <div className="usage-trend-grid-lines">
                <div className="grid-line" />
                <div className="grid-line" />
                <div className="grid-line" />
                <div className="grid-line" />
              </div>

              {/* Stacked Bars Area */}
              <div className="usage-trend-bars-container">
                {data?.dailyTrends.map((day, idx) => {
                  const barHeightPct =
                    day.totalTokens > 0
                      ? Math.max(3, (day.totalTokens / maxDayTokens) * 100)
                      : 0;

                  return (
                    <div
                      key={day.isoDate || idx}
                      className="usage-trend-bar-col"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredBar({
                          day,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div
                        className="usage-stacked-bar"
                        style={{ height: `${barHeightPct}%` }}
                      >
                        {day.totalTokens > 0 &&
                          Object.entries(day.models).map(([mName, tok]) => {
                            const segHeightPct = (tok / day.totalTokens) * 100;
                            return (
                              <div
                                key={mName}
                                className="usage-bar-segment"
                                style={{
                                  height: `${segHeightPct}%`,
                                  backgroundColor: getModelColor(mName),
                                }}
                              />
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Hover Tooltip for Stacked Bar */}
              {hoveredBar && (
                <div className="usage-bar-hover-card">
                  <div className="hover-card-header">{hoveredBar.day.dateLabel}</div>
                  <div className="hover-card-total">
                    总计: {formatTokenNumber(hoveredBar.day.totalTokens)} Tokens
                  </div>
                  {Object.keys(hoveredBar.day.models).length > 0 && (
                    <div className="hover-card-models">
                      {Object.entries(hoveredBar.day.models).map(([mName, tok]) => (
                        <div key={mName} className="hover-card-model-row">
                          <span
                            className="hover-model-dot"
                            style={{ backgroundColor: getModelColor(mName) }}
                          />
                          <span className="hover-model-name">{mName}</span>
                          <span
                            className="hover-model-tok"
                            title={`${tok.toLocaleString()} Tokens`}
                          >
                            {formatTokenNumber(tok)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* X-Axis Date Labels */}
              <div className="usage-trend-xaxis">
                {xAxisLabels.map((lbl, i) => (
                  <span key={i} className="xaxis-label">
                    {lbl.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Bottom Models Legend */}
            {data?.models && data.models.length > 0 && (
              <div className="usage-models-legend">
                {data.models.map((m) => (
                  <div key={m.id} className="usage-legend-item">
                    <span
                      className="usage-legend-dot"
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="usage-legend-model-name">{m.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
