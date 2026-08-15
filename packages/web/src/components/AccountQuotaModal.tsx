import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { IconSpinner, IconX, IconRefresh, IconGear } from "./Icons";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  sidebarWidth?: number;
}

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

import {
  getCachedQuotaSummary,
  setCachedQuotaSummary,
  getCachedUserStatus,
  setCachedUserStatus,
} from "../utils/quotaCache";

export function AccountQuotaModal({
  isOpen,
  onClose,
  onOpenSettings,
  sidebarWidth = 250,
}: Props) {
  const [data, setData] = useState<any>(() => {
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
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Fetch / refresh user quota instantly on open or manual click
  const fetchQuota = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, quotaRes] = await Promise.all([
        api.userStatus().catch(() => null),
        api.quota().catch(() => null),
      ]);
      const base = statusRes?.userStatus ?? statusRes ?? {};
      const quotaSummary =
        (quotaRes?.groups && quotaRes.groups.length > 0 ? quotaRes : null) ??
        statusRes?.userQuotaSummary ??
        statusRes?.userStatus?.userQuotaSummary ??
        base?.userQuotaSummary;

      if (quotaSummary) {
        setCachedQuotaSummary(quotaSummary);
      }
      if (statusRes) {
        setCachedUserStatus(statusRes);
      }

      setData({
        ...base,
        userQuotaSummary: quotaSummary,
      });
      setLastRefreshed(new Date());
    } catch (err) {
      console.error("Failed to fetch user status / quota:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Immediate refresh on open
  useEffect(() => {
    if (isOpen) {
      void fetchQuota();
    }
  }, [isOpen, fetchQuota]);

  // Keyboard close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Extract family-level quotas matching the native Antigravity client
  const quotaSummary = useMemo(() => {
    // 1. If official userQuotaSummary groups exist, use exact bucket values
    const summary =
      data?.userQuotaSummary ??
      data?.userStatus?.userQuotaSummary ??
      data?.planStatus?.userQuotaSummary;
    if (summary?.groups && summary.groups.length > 0) {
      const geminiGroup = summary.groups.find((g: any) =>
        /gemini/i.test(g.displayName || "")
      );
      const geminiWeeklyBucket = geminiGroup?.buckets?.find(
        (b: any) => b.bucketId === "gemini-weekly" || b.window === "weekly"
      );
      const gemini5hBucket = geminiGroup?.buckets?.find(
        (b: any) => b.bucketId === "gemini-5h" || b.window === "5h"
      );

      const partnerGroup = summary.groups.find((g: any) =>
        /claude|gpt|3p/i.test(g.displayName || "")
      );
      const partnerWeeklyBucket = partnerGroup?.buckets?.find(
        (b: any) => b.bucketId === "3p-weekly" || b.window === "weekly"
      );
      const partner5hBucket = partnerGroup?.buckets?.find(
        (b: any) => b.bucketId === "3p-5h" || b.window === "5h"
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

    // 2. Fallback to clientModelConfigs
    const configs = data?.cascadeModelConfigData?.clientModelConfigs || [];

    // Gemini Models
    const geminiConfigs = configs.filter(
      (c: any) =>
        /gemini/i.test(c.modelId || "") || /gemini/i.test(c.label || ""),
    );

    const primaryGemini =
      geminiConfigs.find((c: any) => c.modelId?.includes("3.7")) ??
      geminiConfigs.find((c: any) => c.modelId?.includes("3.6")) ??
      geminiConfigs[0];

    const gemini5hFraction = primaryGemini?.quotaInfo?.remainingFraction ?? 1.0;
    const gemini5hReset = primaryGemini?.quotaInfo?.resetTime;

    // Weekly fraction: from planStatus or minimum of gemini configs
    let geminiWeeklyFraction =
      data?.planStatus?.weeklyQuotaRemaining ??
      data?.planStatus?.geminiWeeklyQuota ??
      data?.weeklyQuotaRemaining;

    if (geminiWeeklyFraction === undefined) {
      const fractions = geminiConfigs
        .map((c: any) => c.quotaInfo?.remainingFraction)
        .filter((f: any) => typeof f === "number");
      geminiWeeklyFraction =
        fractions.length > 0 ? Math.min(...fractions) : 1.0;
    }

    // Claude & GPT Models
    const partnerConfigs = configs.filter(
      (c: any) =>
        /claude|gpt|anthropic|openai/i.test(c.modelId || "") ||
        /claude|gpt|anthropic|openai/i.test(c.label || ""),
    );

    const primaryPartner =
      partnerConfigs.find((c: any) => c.modelId?.includes("sonnet")) ??
      partnerConfigs.find((c: any) => c.modelId?.includes("120b")) ??
      partnerConfigs[0];

    const partner5hFraction =
      primaryPartner?.quotaInfo?.remainingFraction ?? 1.0;
    const partner5hReset = primaryPartner?.quotaInfo?.resetTime;

    let partnerWeeklyFraction =
      data?.planStatus?.partnerWeeklyQuotaRemaining ??
      data?.planStatus?.partnerWeeklyQuota;

    if (partnerWeeklyFraction === undefined) {
      const fractions = partnerConfigs
        .map((c: any) => c.quotaInfo?.remainingFraction)
        .filter((f: any) => typeof f === "number");
      partnerWeeklyFraction =
        fractions.length > 0 ? Math.min(...fractions) : 1.0;
    }

    return {
      gemini: {
        weeklyFraction: geminiWeeklyFraction,
        weeklyReset: undefined,
        fiveHourFraction: gemini5hFraction,
        fiveHourReset: gemini5hReset,
      },
      partner: {
        weeklyFraction: partnerWeeklyFraction,
        weeklyReset: undefined,
        fiveHourFraction: partner5hFraction,
        fiveHourReset: partner5hReset,
      },
    };
  }, [data]);

  if (!isOpen) return null;

  const username = data?.name || "Developer";
  const email = data?.email || "";
  const planName =
    data?.planStatus?.planInfo?.planName ||
    data?.userTier?.name ||
    "Google AI Pro";

  const avatarInitial = username.slice(0, 2).toUpperCase();
  const popoverWidth = Math.max(260, Math.min(sidebarWidth || 270, 290));

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

  return (
    <div className="zcode-quota-popover-backdrop" onClick={onClose}>
      <div
        className="zcode-quota-popover"
        style={{ width: `${popoverWidth}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="账户配额状态"
      >
        {/* Header */}
        <div className="zcode-quota-header">
          <div className="zcode-quota-user-row">
            <div className="zcode-footer-avatar zcode-quota-avatar">
              <span className="zcode-avatar-fallback">{avatarInitial}</span>
            </div>
            <div className="zcode-quota-user-meta">
              <div className="zcode-quota-name-row">
                <span className="zcode-quota-username">{username}</span>
                <span className="zcode-quota-plan-badge">{planName}</span>
              </div>
              {email && <span className="zcode-quota-email">{email}</span>}
            </div>
          </div>

          <div className="zcode-quota-header-actions">
            <button
              className="zcode-quota-refresh-btn"
              onClick={fetchQuota}
              title={
                lastRefreshed
                  ? `刷新额度 (上次同步: ${lastRefreshed.toLocaleTimeString()})`
                  : "刷新额度"
              }
              disabled={loading}
            >
              <IconRefresh size={12} className={loading ? "icon-spin" : ""} />
            </button>
            <button
              className="zcode-quota-icon-btn"
              onClick={onClose}
              title="关闭"
            >
              <IconX size={13} />
            </button>
          </div>
        </div>

        {/* Quota Body */}
        <div className="zcode-quota-body">
          {loading && !data ? (
            <div className="zcode-quota-loading">
              <IconSpinner size={16} className="icon-spin" />
              <span>同步配额…</span>
            </div>
          ) : (
            <div className="zcode-quota-groups">
              {/* 1. Gemini 系列模型配额 */}
              <div className="zcode-quota-group">
                <div className="zcode-quota-group-title">
                  <span>Gemini 系列配额</span>
                </div>

                {/* 每周剩余额度 */}
                <div className="zcode-quota-sub-item">
                  <div className="zcode-quota-item-header">
                    <span className="zcode-quota-item-label">每周剩余额度</span>
                    <span
                      className={`zcode-quota-percent-pill ${geminiWeeklyPercent < 20 ? "low" : geminiWeeklyPercent < 60 ? "medium" : "normal"}`}
                    >
                      {geminiWeeklyPercent}%
                    </span>
                  </div>
                  <div className="zcode-quota-progress-track">
                    <div
                      className={`zcode-quota-progress-bar ${geminiWeeklyPercent < 20 ? "low" : geminiWeeklyPercent < 60 ? "medium" : "normal"}`}
                      style={{ width: `${Math.max(2, geminiWeeklyPercent)}%` }}
                    />
                  </div>
                </div>

                {/* 5小时动态剩余额度 */}
                <div className="zcode-quota-sub-item">
                  <div className="zcode-quota-item-header">
                    <span className="zcode-quota-item-label">5小时动态额度</span>
                    <span
                      className={`zcode-quota-percent-pill ${gemini5hPercent < 20 ? "low" : gemini5hPercent < 60 ? "medium" : "normal"}`}
                    >
                      {gemini5hPercent}%
                    </span>
                  </div>
                  <div className="zcode-quota-progress-track">
                    <div
                      className={`zcode-quota-progress-bar ${gemini5hPercent < 20 ? "low" : gemini5hPercent < 60 ? "medium" : "normal"}`}
                      style={{ width: `${Math.max(2, gemini5hPercent)}%` }}
                    />
                  </div>
                  {quotaSummary.gemini.fiveHourReset && (
                    <div className="zcode-quota-subtext">
                      {formatResetTime(quotaSummary.gemini.fiveHourReset)}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Claude 与 GPT 系列模型配额 */}
              <div className="zcode-quota-group">
                <div className="zcode-quota-group-title">
                  <span>Claude & GPT 系列配额</span>
                </div>

                {/* 每周剩余额度 */}
                <div className="zcode-quota-sub-item">
                  <div className="zcode-quota-item-header">
                    <span className="zcode-quota-item-label">每周剩余额度</span>
                    <span
                      className={`zcode-quota-percent-pill ${partnerWeeklyPercent < 20 ? "low" : partnerWeeklyPercent < 60 ? "medium" : "normal"}`}
                    >
                      {partnerWeeklyPercent}%
                    </span>
                  </div>
                  <div className="zcode-quota-progress-track">
                    <div
                      className={`zcode-quota-progress-bar ${partnerWeeklyPercent < 20 ? "low" : partnerWeeklyPercent < 60 ? "medium" : "normal"}`}
                      style={{ width: `${Math.max(2, partnerWeeklyPercent)}%` }}
                    />
                  </div>
                </div>

                {/* 5小时动态剩余额度 */}
                <div className="zcode-quota-sub-item">
                  <div className="zcode-quota-item-header">
                    <span className="zcode-quota-item-label">5小时动态额度</span>
                    <span
                      className={`zcode-quota-percent-pill ${partner5hPercent < 20 ? "low" : partner5hPercent < 60 ? "medium" : "normal"}`}
                    >
                      {partner5hPercent}%
                    </span>
                  </div>
                  <div className="zcode-quota-progress-track">
                    <div
                      className={`zcode-quota-progress-bar ${partner5hPercent < 20 ? "low" : partner5hPercent < 60 ? "medium" : "normal"}`}
                      style={{ width: `${Math.max(2, partner5hPercent)}%` }}
                    />
                  </div>
                  {quotaSummary.partner.fiveHourReset && (
                    <div className="zcode-quota-subtext">
                      {formatResetTime(quotaSummary.partner.fiveHourReset)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="zcode-quota-modal-footer">
          {onOpenSettings && (
            <button
              className="zcode-quota-settings-link-btn"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <IconGear size={12} />
              <span>账户设置</span>
            </button>
          )}

          <button className="zcode-quota-close-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

