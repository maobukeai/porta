import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { IconCamera, IconGauge, IconRefresh } from "./Icons";
import {
  getCachedQuotaSummary,
  setCachedQuotaSummary,
  getCachedUserStatus,
  setCachedUserStatus,
} from "../utils/quotaCache";

export interface ModelConfig {
  label: string;
  modelOrAlias: { model: string };
  supportsImages: boolean;
  isRecommended: boolean;
  quotaInfo?: { remainingFraction: number; resetTime?: string };
}

interface Props {
  selectedModel: string | null;
  onSelect: (model: string) => void;
}

interface ParsedTierItem {
  config: ModelConfig;
  baseName: string;
  tier: string;
  tierDisplay: string;
  tierDescription: string;
  fullId: string;
}

interface ModelBaseGroup {
  baseName: string;
  items: ParsedTierItem[];
  hasActive: boolean;
  activeItem?: ParsedTierItem;
}

const TIER_ORDER: Record<string, number> = {
  high: 1,
  medium: 2,
  low: 3,
  thinking: 4,
  default: 5,
};

export const VIEW_USAGE_KEY = "__VIEW_USAGE__";

function formatResetTime(iso?: string): string {
  if (!iso) return "暂无重置信息";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "暂无重置信息";

  const now = Date.now();
  const diffMs = date.getTime() - now;

  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffMs <= 0) {
    return `将于 ${timeStr} 自动重置`;
  }

  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) {
    return `将于 ${timeStr} 自动重置 (约 ${mins} 分钟后)`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `将于 ${timeStr} 自动重置 (约 ${hours}小时${remainingMins > 0 ? `${remainingMins}分` : ""}后)`;
}

export function CircularProgressRing({
  fraction,
  size = 15,
  strokeWidth = 2,
}: {
  fraction: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, isNaN(fraction) ? 1 : fraction));
  const offset = circumference * (1 - clamped);

  let strokeColor = "#34a853";
  if (clamped < 0.2) strokeColor = "#ef4444";
  else if (clamped < 0.6) strokeColor = "#eab308";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="zcode-ring-svg"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="zcode-ring-bg"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="zcode-ring-indicator"
      />
    </svg>
  );
}

function formatTierInfo(tier: string): { display: string; desc: string } {
  const t = tier.toLowerCase().trim();
  if (t === "high" || t === "高") {
    return { display: "High (高思考)", desc: "深度推理与严密规划" };
  }
  if (t === "medium" || t === "中") {
    return { display: "Medium (中思考)", desc: "日常编程与逻辑权衡" };
  }
  if (t === "low" || t === "低") {
    return { display: "Low (低思考/快速)", desc: "极速响应与简单问答" };
  }
  if (t === "thinking" || t === "思考") {
    return { display: "Thinking (深度思考)", desc: "复杂架构分析模式" };
  }
  if (t === "default" || t === "标准") {
    return { display: "标准模式 (Default)", desc: "模型默认推理策略" };
  }
  return { display: tier, desc: "标准模式" };
}

function parseModelAndTier(config: ModelConfig): ParsedTierItem {
  const rawLabel = config.label || config.modelOrAlias.model || "";
  const fullId = config.modelOrAlias.model;

  // Match "(High)", "(Medium)", "(Low)", "(Thinking)", "(低)", "(中)", "(高)", "(思考)"
  const match = rawLabel.match(/^(.*?)(?:\s*\((Low|Medium|High|Thinking|低|中|高|思考|Default|标准)\))?$/i);

  if (match && match[2]) {
    const rawTier = match[2].trim();
    let normalizedTier = rawTier;
    if (rawTier === "高") normalizedTier = "High";
    else if (rawTier === "中") normalizedTier = "Medium";
    else if (rawTier === "低") normalizedTier = "Low";
    else if (rawTier === "思考") normalizedTier = "Thinking";

    const { display, desc } = formatTierInfo(normalizedTier);
    return {
      config,
      baseName: match[1].trim(),
      tier: normalizedTier,
      tierDisplay: display,
      tierDescription: desc,
      fullId,
    };
  }

  const { display, desc } = formatTierInfo("Default");
  return {
    config,
    baseName: rawLabel.trim(),
    tier: "Default",
    tierDisplay: display,
    tierDescription: desc,
    fullId,
  };
}

export function ModelSelector({ selectedModel, onSelect }: Props) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [activeGroupHover, setActiveGroupHover] = useState<string | null>(null);
  const [hoveredOffsetY, setHoveredOffsetY] = useState(0);
  const [userStatusData, setUserStatusData] = useState<any>(() => {
    const cachedStatus = getCachedUserStatus();
    const cachedQuota = getCachedQuotaSummary();
    if (cachedStatus || cachedQuota) {
      const base = cachedStatus?.userStatus ?? cachedStatus ?? {};
      return {
        ...base,
        userQuotaSummary: cachedQuota ?? base?.userQuotaSummary,
      };
    }
    return null;
  });
  const [loadingQuota, setLoadingQuota] = useState(false);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const basePanelRef = useRef<HTMLDivElement>(null);
  const tierPanelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
        setModels(data.clientModelConfigs ?? []);
        setDefaultModel(
          data.defaultOverrideModelConfig?.modelOrAlias?.model ?? null,
        );
        setFetchError(false);
        return;
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
    setFetchError(true);
  }, []);

  const fetchQuotaData = useCallback(async () => {
    setLoadingQuota(true);
    try {
      const [statusRes, quotaRes] = await Promise.all([
        api.userStatus().catch(() => null),
        api.quota().catch(() => null),
      ]);
      const base = statusRes ?? {};
      const quotaSummary =
        (quotaRes?.groups && quotaRes.groups.length > 0 ? quotaRes : null) ??
        base?.userQuotaSummary ??
        base?.userStatus?.userQuotaSummary ??
        (base as any)?.planStatus?.userQuotaSummary;

      if (quotaSummary) {
        setCachedQuotaSummary(quotaSummary);
      }
      if (statusRes) {
        setCachedUserStatus(statusRes);
      }

      setUserStatusData({
        ...base,
        ...(base.userStatus && typeof base.userStatus === "object" ? base.userStatus : {}),
        userQuotaSummary: quotaSummary,
      });
    } catch (err) {
      console.error("Failed to fetch user status / quota:", err);
    } finally {
      setLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (open) {
      void fetchQuotaData();
    }
  }, [open, fetchQuotaData]);

  // Close popover on outside click/tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e instanceof TouchEvent ? e.touches[0]?.target : e.target;
      if (ref.current && target && !ref.current.contains(target as Node)) {
        setOpen(false);
        setActiveGroupHover(null);
      }
    };
    document.addEventListener("mousedown", handler as EventListener);
    document.addEventListener("touchstart", handler as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler as EventListener);
      document.removeEventListener("touchstart", handler as EventListener);
    };
  }, [open]);

  // Keyboard navigation support
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setActiveGroupHover(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const active =
    selectedModel ??
    defaultModel ??
    models.find((m) => m.isRecommended)?.modelOrAlias?.model ??
    models[0]?.modelOrAlias?.model ??
    "MODEL_PLACEHOLDER";

  // Auto-bind default model if none selected
  useEffect(() => {
    if (!selectedModel && active && models.length > 0 && active !== "MODEL_PLACEHOLDER") {
      onSelect(active);
    }
  }, [active, selectedModel, models.length, onSelect]);

  // Group models by Base Model Name (左侧：模型名称)
  const baseGroups = useMemo<ModelBaseGroup[]>(() => {
    const map = new Map<string, ParsedTierItem[]>();

    for (const m of models) {
      const parsed = parseModelAndTier(m);
      if (!map.has(parsed.baseName)) {
        map.set(parsed.baseName, []);
      }
      map.get(parsed.baseName)!.push(parsed);
    }

    const result: ModelBaseGroup[] = [];
    for (const [baseName, items] of map.entries()) {
      // Sort tiers inside group: High -> Medium -> Low -> Thinking -> Default
      items.sort((a, b) => {
        const orderA = TIER_ORDER[a.tier.toLowerCase()] ?? 99;
        const orderB = TIER_ORDER[b.tier.toLowerCase()] ?? 99;
        return orderA - orderB;
      });

      const activeItem = items.find((i) => i.fullId === active);
      result.push({
        baseName,
        items,
        hasActive: !!activeItem,
        activeItem,
      });
    }

    // Sort models: Active model group first, then Gemini 3.7 > 3.6 > 3.5 > 3.1 > Claude > GPT > others
    const getScore = (name: string, hasActive: boolean) => {
      let score = 0;
      if (hasActive) score += 50000;
      const n = name.toLowerCase();
      if (n.includes("3.7")) score += 10000;
      else if (n.includes("3.6")) score += 8000;
      else if (n.includes("3.5")) score += 6000;
      else if (n.includes("3.1")) score += 4000;
      if (n.includes("gemini")) score += 2000;
      else if (n.includes("claude") || n.includes("sonnet")) score += 1500;
      else if (n.includes("gpt") || n.includes("openai")) score += 1000;
      else if (n.includes("deepseek")) score += 800;
      return score;
    };

    result.sort((a, b) => getScore(b.baseName, b.hasActive) - getScore(a.baseName, a.hasActive));
    return result;
  }, [models, active]);

  // Current active/hovered base model group
  const currentActiveGroup = useMemo(() => {
    if (activeGroupHover === VIEW_USAGE_KEY) {
      return null;
    }
    if (activeGroupHover) {
      const found = baseGroups.find((g) => g.baseName === activeGroupHover);
      if (found) return found;
    }
    const activeFound = baseGroups.find((g) => g.hasActive);
    if (activeFound) return activeFound;
    return baseGroups[0] ?? null;
  }, [activeGroupHover, baseGroups]);

  // Extract quotas for Usage View
  const quotaSummary = useMemo(() => {
    const summary =
      userStatusData?.userQuotaSummary ??
      userStatusData?.userStatus?.userQuotaSummary ??
      userStatusData?.planStatus?.userQuotaSummary;

    if (summary?.groups && summary.groups.length > 0) {
      const geminiGroup = summary.groups.find((g: any) =>
        /gemini/i.test(g.displayName || ""),
      );
      const geminiWeeklyBucket = geminiGroup?.buckets?.find(
        (b: any) => b.bucketId === "gemini-weekly" || b.window === "weekly",
      );
      const gemini5hBucket = geminiGroup?.buckets?.find(
        (b: any) => b.bucketId === "gemini-5h" || b.window === "5h",
      );

      const partnerGroup = summary.groups.find((g: any) =>
        /claude|gpt|3p/i.test(g.displayName || ""),
      );
      const partnerWeeklyBucket = partnerGroup?.buckets?.find(
        (b: any) => b.bucketId === "3p-weekly" || b.window === "weekly",
      );
      const partner5hBucket = partnerGroup?.buckets?.find(
        (b: any) => b.bucketId === "3p-5h" || b.window === "5h",
      );

      return {
        gemini: {
          weeklyFraction: geminiWeeklyBucket?.remainingFraction ?? 1.0,
          weeklyReset: geminiWeeklyBucket?.resetTime,
          fiveHourFraction: gemini5hBucket?.remainingFraction ?? 1.0,
          fiveHourReset: gemini5hBucket?.resetTime,
        },
        partner: {
          weeklyFraction: partnerWeeklyBucket?.remainingFraction ?? 1.0,
          weeklyReset: partnerWeeklyBucket?.resetTime,
          fiveHourFraction: partner5hBucket?.remainingFraction ?? 1.0,
          fiveHourReset: partner5hBucket?.resetTime,
        },
      };
    }

    // Fallback using model configs
    const geminiConfigs = models.filter(
      (c) =>
        /gemini/i.test(c.modelOrAlias?.model || "") ||
        /gemini/i.test(c.label || ""),
    );
    const primaryGemini =
      geminiConfigs.find((c) => c.label?.includes("3.7")) ??
      geminiConfigs.find((c) => c.label?.includes("3.6")) ??
      geminiConfigs[0];
    const gemini5hFraction = primaryGemini?.quotaInfo?.remainingFraction ?? 1.0;
    const gemini5hReset = primaryGemini?.quotaInfo?.resetTime;

    let geminiWeeklyFraction =
      userStatusData?.planStatus?.weeklyQuotaRemaining ??
      userStatusData?.planStatus?.geminiWeeklyQuota ??
      userStatusData?.weeklyQuotaRemaining;

    if (geminiWeeklyFraction === undefined) {
      const fractions = geminiConfigs
        .map((c) => c.quotaInfo?.remainingFraction)
        .filter((f): f is number => typeof f === "number");
      geminiWeeklyFraction =
        fractions.length > 0 ? Math.min(...fractions) : 1.0;
    }

    const partnerConfigs = models.filter(
      (c) =>
        /claude|gpt|anthropic|openai/i.test(c.modelOrAlias?.model || "") ||
        /claude|gpt|anthropic|openai/i.test(c.label || ""),
    );
    const primaryPartner =
      partnerConfigs.find((c) => c.label?.includes("Sonnet")) ??
      partnerConfigs.find((c) => c.label?.includes("120B")) ??
      partnerConfigs[0];
    const partner5hFraction =
      primaryPartner?.quotaInfo?.remainingFraction ?? 1.0;
    const partner5hReset = primaryPartner?.quotaInfo?.resetTime;

    let partnerWeeklyFraction =
      userStatusData?.planStatus?.partnerWeeklyQuotaRemaining ??
      userStatusData?.planStatus?.partnerWeeklyQuota;

    if (partnerWeeklyFraction === undefined) {
      const fractions = partnerConfigs
        .map((c) => c.quotaInfo?.remainingFraction)
        .filter((f): f is number => typeof f === "number");
      partnerWeeklyFraction =
        fractions.length > 0 ? Math.min(...fractions) : 1.0;
    }

    return {
      gemini: {
        weeklyFraction: geminiWeeklyFraction ?? 1.0,
        weeklyReset: undefined,
        fiveHourFraction: gemini5hFraction ?? 1.0,
        fiveHourReset: gemini5hReset,
      },
      partner: {
        weeklyFraction: partnerWeeklyFraction ?? 1.0,
        weeklyReset: undefined,
        fiveHourFraction: partner5hFraction ?? 1.0,
        fiveHourReset: partner5hReset,
      },
    };
  }, [userStatusData, models]);

  // Smooth hover handling with position update to follow mouse
  const updateOffsetY = useCallback((targetKey: string, el?: HTMLElement | null) => {
    const targetEl = el || itemRefs.current.get(targetKey);
    const baseEl = basePanelRef.current;
    if (!targetEl || !baseEl) return;

    const baseRect = baseEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const rawOffset = Math.round(targetRect.top - baseRect.top);

    const tierEl = tierPanelRef.current;
    const tierHeight = tierEl ? tierEl.offsetHeight : 140;
    const baseHeight = baseEl.offsetHeight;
    const maxOffset = Math.max(0, baseHeight - tierHeight);

    const clamped = Math.max(0, Math.min(rawOffset, maxOffset));
    setHoveredOffsetY(clamped);
  }, []);

  const handleModelHover = useCallback((targetKey: string, el?: HTMLElement | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setActiveGroupHover(targetKey);
      updateOffsetY(targetKey, el);
    }, 25);
  }, [updateOffsetY]);

  // Auto align position when dropdown opens or active model group changes
  useEffect(() => {
    if (open) {
      const activeKey = activeGroupHover || currentActiveGroup?.baseName;
      if (activeKey) {
        const frameId = requestAnimationFrame(() => {
          updateOffsetY(activeKey);
        });
        return () => cancelAnimationFrame(frameId);
      }
    }
  }, [open, activeGroupHover, currentActiveGroup?.baseName, updateOffsetY]);

  // Trigger button display text: e.g. "Gemini 3.7 Flash (High)"
  const triggerDisplay = useMemo(() => {
    const found = models.find((m) => m.modelOrAlias.model === active);
    if (found) {
      return found.label || active;
    }
    if (active && active !== "MODEL_PLACEHOLDER") {
      return active;
    }
    return "选择模型";
  }, [models, active]);

  const geminiWeeklyPercent = Math.round(
    quotaSummary.gemini.weeklyFraction * 100,
  );
  const gemini5hPercent = Math.round(
    quotaSummary.gemini.fiveHourFraction * 100,
  );
  const partnerWeeklyPercent = Math.round(
    quotaSummary.partner.weeklyFraction * 100,
  );
  const partner5hPercent = Math.round(
    quotaSummary.partner.fiveHourFraction * 100,
  );

  const isShowingUsage = activeGroupHover === VIEW_USAGE_KEY;

  return (
    <div className="model-selector" ref={ref}>
      <button
        className="model-selector-btn"
        onClick={() => {
          if (fetchError || models.length === 0) fetchModels();
          setOpen((v) => {
            if (!v) setActiveGroupHover(null);
            return !v;
          });
        }}
        title="切换 AI 模型与思考等级"
        aria-expanded={open}
      >
        <span className="model-selector-label">{triggerDisplay}</span>
        <span className="model-selector-caret">▾</span>
      </button>

      {open && (
        <div className="zcode-model-cascader">
          {/* Left Column (Level 1): Model Base Names */}
          <div className="zcode-provider-panel zcode-model-base-panel" ref={basePanelRef}>
            <div className="zcode-panel-header">
              <span>模型</span>
              <span className="zcode-panel-header-count">{baseGroups.length}</span>
            </div>

            <div className="zcode-panel-scroll">
              {fetchError && (
                <div
                  className="zcode-menu-item"
                  onClick={() => fetchModels()}
                  style={{ color: "var(--text-tertiary)", justifyContent: "center" }}
                >
                  ⟳ 重新加载模型
                </div>
              )}

              {baseGroups.map((group) => {
                const isHovered =
                  !isShowingUsage && group.baseName === currentActiveGroup?.baseName;
                return (
                  <div
                    key={group.baseName}
                    ref={(el) => {
                      if (el) itemRefs.current.set(group.baseName, el);
                      else itemRefs.current.delete(group.baseName);
                    }}
                    className={`zcode-provider-item ${isHovered ? "hovered" : ""} ${group.hasActive ? "is-active-provider" : ""}`}
                    onMouseEnter={(e) => handleModelHover(group.baseName, e.currentTarget)}
                    onClick={(e) => {
                      setActiveGroupHover(group.baseName);
                      updateOffsetY(group.baseName, e.currentTarget);
                      // If this model only has 1 tier option, click directly selects it
                      if (group.items.length === 1) {
                        onSelect(group.items[0].fullId);
                        setOpen(false);
                      }
                    }}
                  >
                    <div className="zcode-model-title-wrap">
                      <span className="zcode-provider-name">{group.baseName}</span>
                    </div>

                    <div className="zcode-provider-status">
                      {group.hasActive && (
                        <span className="zcode-check-icon" title="当前使用的模型">✓</span>
                      )}
                      <span className="zcode-chevron-right">›</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Divider & Actions */}
            <div className="zcode-menu-divider" />

            {/* View Usage / 查看额度 */}
            <div
              ref={(el) => {
                if (el) itemRefs.current.set(VIEW_USAGE_KEY, el);
                else itemRefs.current.delete(VIEW_USAGE_KEY);
              }}
              className={`zcode-provider-item zcode-usage-menu-item ${isShowingUsage ? "hovered" : ""}`}
              onMouseEnter={(e) => handleModelHover(VIEW_USAGE_KEY, e.currentTarget)}
              onClick={(e) => {
                setActiveGroupHover(VIEW_USAGE_KEY);
                updateOffsetY(VIEW_USAGE_KEY, e.currentTarget);
              }}
              title="查看当前模型额度与配额使用情况"
            >
              <div className="zcode-model-title-wrap">
                <IconGauge size={13} className="zcode-usage-menu-icon" />
                <span className="zcode-provider-name">查看额度</span>
              </div>

              <div className="zcode-provider-status">
                <span className="zcode-chevron-right">›</span>
              </div>
            </div>
          </div>

          {/* Right Column Option 1: Quota / Usage Panel */}
          {isShowingUsage ? (
            <div
              ref={tierPanelRef}
              className="zcode-model-panel zcode-usage-panel"
              style={{
                transform: `translateY(${hoveredOffsetY}px)`,
              }}
            >
              <div className="zcode-usage-header">
                <span className="zcode-usage-header-title">使用额度</span>
                <button
                  className="zcode-usage-refresh-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchQuotaData();
                  }}
                  title="刷新额度"
                  disabled={loadingQuota}
                >
                  <IconRefresh size={11} className={loadingQuota ? "icon-spin" : ""} />
                </button>
              </div>

              <div className="zcode-panel-scroll zcode-usage-scroll">
                {/* Gemini Models Section */}
                <div className="zcode-usage-section">
                  <div className="zcode-usage-section-title">Gemini 系列模型</div>

                  <div className="zcode-usage-card">
                    <div className="zcode-usage-row">
                      <span className="zcode-usage-item-name">每周剩余额度</span>
                      <div className="zcode-usage-val-ring">
                        <span className="zcode-usage-val">{geminiWeeklyPercent}%</span>
                        <CircularProgressRing fraction={quotaSummary.gemini.weeklyFraction} />
                      </div>
                    </div>
                    <div className="zcode-usage-subtext">
                      {quotaSummary.gemini.weeklyReset && geminiWeeklyPercent < 100
                        ? formatResetTime(quotaSummary.gemini.weeklyReset)
                        : geminiWeeklyPercent < 100
                          ? "您已使用部分每周额度"
                          : "每周额度充足"}
                    </div>
                  </div>

                  <div className="zcode-usage-card">
                    <div className="zcode-usage-row">
                      <span className="zcode-usage-item-name">5 小时动态剩余额度</span>
                      <div className="zcode-usage-val-ring">
                        <span className="zcode-usage-val">{gemini5hPercent}%</span>
                        <CircularProgressRing fraction={quotaSummary.gemini.fiveHourFraction} />
                      </div>
                    </div>
                    <div className="zcode-usage-subtext">
                      {quotaSummary.gemini.fiveHourReset && gemini5hPercent < 100
                        ? formatResetTime(quotaSummary.gemini.fiveHourReset)
                        : gemini5hPercent < 100
                          ? "您已使用部分 5 小时额度"
                          : "5 小时额度充足"}
                    </div>
                  </div>
                </div>

                <div className="zcode-menu-divider" />

                {/* Claude & GPT Models Section */}
                <div className="zcode-usage-section">
                  <div className="zcode-usage-section-title">Claude 与 GPT 系列模型</div>

                  <div className="zcode-usage-card">
                    <div className="zcode-usage-row">
                      <span className="zcode-usage-item-name">每周剩余额度</span>
                      <div className="zcode-usage-val-ring">
                        <span className="zcode-usage-val">{partnerWeeklyPercent}%</span>
                        <CircularProgressRing fraction={quotaSummary.partner.weeklyFraction} />
                      </div>
                    </div>
                    <div className="zcode-usage-subtext">
                      {quotaSummary.partner.weeklyReset && partnerWeeklyPercent < 100
                        ? formatResetTime(quotaSummary.partner.weeklyReset)
                        : partnerWeeklyPercent < 100
                          ? "您已使用部分每周额度"
                          : "每周额度充足"}
                    </div>
                  </div>

                  <div className="zcode-usage-card">
                    <div className="zcode-usage-row">
                      <span className="zcode-usage-item-name">5 小时动态剩余额度</span>
                      <div className="zcode-usage-val-ring">
                        <span className="zcode-usage-val">{partner5hPercent}%</span>
                        <CircularProgressRing fraction={quotaSummary.partner.fiveHourFraction} />
                      </div>
                    </div>
                    <div className="zcode-usage-subtext">
                      {quotaSummary.partner.fiveHourReset && partner5hPercent < 100
                        ? formatResetTime(quotaSummary.partner.fiveHourReset)
                        : partner5hPercent < 100
                          ? "您已使用部分 5 小时额度"
                          : "5 小时额度充足"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Right Column Option 2: Thinking Levels / Tiers */
            currentActiveGroup &&
            currentActiveGroup.items.length > 0 && (
              <div
                ref={tierPanelRef}
                className="zcode-model-panel zcode-tier-panel"
                style={{
                  transform: `translateY(${hoveredOffsetY}px)`,
                }}
              >
                <div className="zcode-tier-header">
                  <span>{currentActiveGroup.baseName}</span>
                  <span className="zcode-tier-header-tag">思考等级</span>
                </div>

                <div className="zcode-panel-scroll">
                  {currentActiveGroup.items.map((item) => {
                    const isSelected = item.fullId === active;
                    const quota = item.config.quotaInfo?.remainingFraction ?? 1;

                    return (
                      <div
                        key={item.fullId}
                        className={`zcode-model-item ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          onSelect(item.fullId);
                          setOpen(false);
                        }}
                        title={item.config.label}
                      >
                        <div className="zcode-tier-main">
                          <div className="zcode-tier-name-row">
                            <span className="zcode-tier-name">{item.tierDisplay}</span>
                            {isSelected && <span className="zcode-check-icon">✓</span>}
                          </div>
                          <div className="zcode-tier-desc">{item.tierDescription}</div>
                        </div>

                        <div className="zcode-tier-badges">
                          {item.config.supportsImages && (
                            <span className="zcode-badge-pill" title="支持多模态视觉识图">
                              <IconCamera size={11} />
                            </span>
                          )}
                          {quota < 1 && (
                            <span
                              className="zcode-quota-pill"
                              style={{
                                color: quota < 0.2 ? "#ff5c5c" : "inherit",
                              }}
                              title="剩余额度比例"
                            >
                              {Math.round(quota * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

