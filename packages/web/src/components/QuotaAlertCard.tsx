import { memo, useCallback, useEffect, useState } from "react";
import { IconChevron } from "./Icons";
import { parseQuotaError, parseRefreshTimestamp } from "../utils/quotaError";

interface Props {
  content: string;
  onOpenQuota?: () => void;
  /** True when a newer turn/message has been sent, auto-dismissing this historical card */
  isHistorical?: boolean;
  onAutoDismiss?: () => void;
}

export const QuotaAlertCard = memo(function QuotaAlertCard({
  content,
  onOpenQuota,
  isHistorical = false,
  onAutoDismiss,
}: Props) {
  // If initially mounted on an already historical turn, don't show to avoid flashing stale alerts
  const [dismissed, setDismissed] = useState(isHistorical);
  const [isFading, setIsFading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const info = parseQuotaError(content);

  const startFadeOut = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setDismissed(true);
      onAutoDismiss?.();
    }, 350);
  }, [onAutoDismiss]);

  // 1. Auto-dismiss when user sends a new message (card becomes historical)
  useEffect(() => {
    if (isHistorical && !dismissed && !isFading) {
      startFadeOut();
    }
  }, [isHistorical, dismissed, isFading, startFadeOut]);

  // 2. Auto-dismiss when quota refresh time arrives
  useEffect(() => {
    if (dismissed || isFading) return;
    const targetTimestamp = parseRefreshTimestamp(info.refreshTime);
    if (!targetTimestamp) return;

    const remainingMs = targetTimestamp - Date.now();
    if (remainingMs <= 0) {
      // Refresh time has already passed!
      startFadeOut();
      return;
    }

    if (remainingMs < 48 * 3600 * 1000) {
      const timer = setTimeout(() => {
        startFadeOut();
      }, remainingMs);
      return () => clearTimeout(timer);
    }
  }, [info.refreshTime, dismissed, isFading, startFadeOut]);

  if (dismissed) {
    return null;
  }

  const handleOpenPlans = () => {
    if (onOpenQuota) {
      onOpenQuota();
    } else {
      window.dispatchEvent(new CustomEvent("antigravity:open-quota"));
    }
  };

  const handleCopy = async () => {
    try {
      const textToCopy = info.rawError || info.detail || "";
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const isBaselineQuota = info.isQuotaError && info.errorType === "baseline_quota";
  const isRateLimit = info.errorType === "rate_limit";
  const hasExtraDetails = Boolean(info.rawError && info.rawError !== info.detail);

  return (
    <div
      className={`antigravity-quota-card ${info.errorType || "generic"} ${isFading ? "is-fading-out" : ""}`}
      role="alert"
      aria-live="polite"
    >
      {/* 1. Header: Icon + Title + Quick Close */}
      <div className="antigravity-quota-header">
        <div className="antigravity-quota-header-left">
          <span className="antigravity-quota-icon" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 4.5v4M8 11.5h.01" />
            </svg>
          </span>
          <span className="antigravity-quota-title">{info.title}</span>
        </div>
        <button
          type="button"
          className="antigravity-quota-close-btn"
          onClick={() => setDismissed(true)}
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* 2. Body: Directly display the clean, concise summary outside */}
      <div className="antigravity-quota-body">
        {isBaselineQuota ? (
          <p className="antigravity-quota-desc">
            {info.refreshTime ? (
              <>
                您的方案基础配额将于{" "}
                <strong className="antigravity-quota-highlight">
                  {info.refreshTime}
                </strong>{" "}
                刷新重置。您可以升级至 Google AI Ultra 方案以获取更高的速率限制。{" "}
                <button
                  type="button"
                  className="antigravity-quota-link-btn"
                  onClick={handleOpenPlans}
                >
                  查看方案
                </button>
              </>
            ) : (
              <>
                <span>{info.detail}</span>
                <button
                  type="button"
                  className="antigravity-quota-link-btn"
                  onClick={handleOpenPlans}
                >
                  查看方案
                </button>
              </>
            )}
          </p>
        ) : (
          <div className="antigravity-quota-direct-error">
            <p className="antigravity-quota-desc">{info.detail}</p>
            {info.suggestion && (
              <p className="antigravity-quota-subdesc">{info.suggestion}</p>
            )}
          </div>
        )}
      </div>

      {/* 3. Action Buttons: Clean, concise and compact */}
      <div className="antigravity-quota-actions">
        <div className="antigravity-quota-actions-left">
          <button
            type="button"
            className="antigravity-quota-btn antigravity-quota-btn-dismiss"
            onClick={() => setDismissed(true)}
          >
            忽略
          </button>
          {hasExtraDetails && (
            <button
              type="button"
              className="antigravity-quota-btn antigravity-quota-btn-raw-toggle"
              onClick={() => setShowRaw((v) => !v)}
            >
              <span>{showRaw ? "收起详细日志" : "展开详细日志"}</span>
              <IconChevron
                size={11}
                className={`quota-chevron ${showRaw ? "open" : ""}`}
              />
            </button>
          )}
          <button
            type="button"
            className="antigravity-quota-btn antigravity-quota-btn-copy"
            onClick={handleCopy}
            title="复制报错信息"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>

        {isBaselineQuota && (
          <div className="antigravity-quota-actions-right">
            <button
              type="button"
              className="antigravity-quota-btn antigravity-quota-btn-secondary"
              onClick={handleOpenPlans}
            >
              查看方案
            </button>
            <button
              type="button"
              className="antigravity-quota-btn antigravity-quota-btn-primary"
              onClick={handleOpenPlans}
            >
              开启超额配额
            </button>
          </div>
        )}

        {isRateLimit && (
          <div className="antigravity-quota-actions-right">
            <button
              type="button"
              className="antigravity-quota-btn antigravity-quota-btn-secondary"
              onClick={handleOpenPlans}
            >
              查看方案
            </button>
          </div>
        )}
      </div>

      {/* 4. Collapsible full log / stack trace */}
      {showRaw && info.rawError && (
        <div className="antigravity-quota-raw-section">
          <pre className="quota-raw-log">
            <code>{info.rawError}</code>
          </pre>
        </div>
      )}
    </div>
  );
});
