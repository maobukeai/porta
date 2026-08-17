import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { IconSpinner, IconUser, IconCheck, IconRefresh } from "./Icons";
import type {
  CockpitAccount,
  CockpitQuota,
  CockpitQuotaGroup,
  CockpitStatus,
} from "../types";

/**
 * Antigravity 多账号管理（对接本机 cockpit-tools）。
 *
 * 切换账号时 cockpit-tools 会重写凭据并可能重启 Antigravity —— 期间
 * Language Server 会短暂掉线，诊断页可能弹出并自动恢复，属正常现象。
 *
 * 额度：显示分组额度（quota_summary 的周/5h 限额，与 cockpit UI 一致；
 * 每模型的 remainingFraction 是粗粒度桶值，几乎总是 100%，不作主展示）。
 * 每行 ↻ 按钮会用该账号令牌实时向 Google 拉取（令牌只留在代理端）。
 */

type SwitchState =
  | { phase: "idle" }
  | { phase: "confirming"; account: CockpitAccount }
  | { phase: "switching"; account: CockpitAccount };

function formatTier(tier?: string): string {
  if (!tier) return "";
  switch (tier.toLowerCase()) {
    case "free":
      return "免费版";
    case "pro":
      return "Pro";
    case "ultra":
    case "max":
      return "Ultra";
    default:
      return tier;
  }
}

/** "5 分钟前" / "3 小时前" / "2 天前" for quota snapshot age. */
function formatQuotaAge(updatedAt: number): string {
  if (!updatedAt) return "";
  const mins = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function quotaLevel(percent: number): string {
  if (percent >= 50) return "ok";
  if (percent >= 20) return "warn";
  return "low";
}

/** "Gemini Models" → "Gemini"; keep unknown names as-is. */
function shortGroupName(name: string): string {
  return name.replace(/\s*Models$/i, "").replace(/^Claude and GPT/i, "Claude/GPT");
}

function bucketLabel(window: string): string {
  if (window === "weekly") return "周";
  if (window === "5h") return "5时";
  return window;
}

/** Group chips: e.g. "Gemini 周77% · 5时100%", colored by the lowest bucket. */
function groupChips(quota: CockpitQuota): {
  key: string;
  label: string;
  percent: number;
  title?: string;
}[] {
  return (quota.groups ?? []).map((g: CockpitQuotaGroup, i) => {
    const lowest = Math.min(...g.buckets.map((b) => b.remainingPercent));
    const label = `${shortGroupName(g.name)} ${g.buckets
      .map((b) => `${bucketLabel(b.window)}${b.remainingPercent}%`)
      .join(" · ")}`;
    const resetTitle = g.buckets
      .filter((b) => b.resetTime)
      .map((b) => `${bucketLabel(b.window)}重置：${b.resetTime?.slice(0, 16).replace("T", " ")}`)
      .join("\n");
    return {
      key: `g${i}`,
      label,
      percent: lowest,
      ...(resetTitle ? { title: resetTitle } : {}),
    };
  });
}

/** Up to N chips, most-constrained models first. */
function topModels(quota: CockpitQuota, count = 3): CockpitQuota["models"] {
  return [...quota.models]
    .sort((a, b) => a.remainingPercent - b.remainingPercent)
    .slice(0, count);
}

export function CockpitAccountManager() {
  const [status, setStatus] = useState<CockpitStatus | null>(null);
  const [accounts, setAccounts] = useState<CockpitAccount[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchState, setSwitchState] = useState<SwitchState>({ phase: "idle" });
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchedFlash, setSwitchedFlash] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, acc] = await Promise.all([
        api.cockpitStatus(),
        api.cockpitAccounts().catch(() => null),
      ]);
      setStatus(st);
      if (acc) {
        setAccounts(acc.accounts);
        setCurrentId(acc.currentAccountId);
        setLoadError(null);
      } else if (st.connected) {
        setLoadError("账号列表获取失败");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSwitch = useCallback(async () => {
    if (switchState.phase !== "confirming") return;
    const account = switchState.account;
    setSwitchState({ phase: "switching", account });
    setSwitchError(null);
    // 切换可能导致 Antigravity 重启 → LS 掉线 → 诊断页；告知其抑制弹出
    window.dispatchEvent(new CustomEvent("porta:cockpit-switch", { detail: { active: true } }));
    try {
      const res = await api.cockpitSwitchAccount(account.id);
      setSwitchedFlash(`${account.email} ${res.message}`);
      setTimeout(() => setSwitchedFlash(null), 4000);
      await load();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitchState({ phase: "idle" });
      window.dispatchEvent(new CustomEvent("porta:cockpit-switch", { detail: { active: false } }));
    }
  }, [switchState, load]);

  const handleRefreshQuota = useCallback(
    async (account: CockpitAccount) => {
      if (refreshingId) return;
      setRefreshingId(account.id);
      setRefreshError(null);
      try {
        const res = await api.cockpitRefreshQuota(account.id);
        setAccounts((prev) =>
          prev.map((a) => (a.id === account.id ? { ...a, quota: res.quota } : a)),
        );
      } catch (err) {
        setRefreshError({
          id: account.id,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRefreshingId(null);
      }
    },
    [refreshingId],
  );

  if (loading) {
    return (
      <div className="settings-card-group">
        <div className="settings-card-group-title">Antigravity 多账号（Cockpit）</div>
        <div className="cockpit-status-row">
          <IconSpinner size={14} className="icon-spin" />
          <span className="cockpit-status-text">正在检测 cockpit-tools…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-card-group">
      <div className="settings-card-group-title">Antigravity 多账号（Cockpit）</div>

      {/* 连接状态 */}
      <div className="cockpit-status-row">
        {status?.connected ? (
          <>
            <span className="settings-status-online">● 已连接</span>
            <span className="cockpit-status-text">
              cockpit-tools {status.version ?? ""} · 端口 {status.wsPort}
            </span>
          </>
        ) : (
          <>
            <span className="settings-status-offline">● 未连接</span>
            <span className="cockpit-status-text">
              {status?.error ?? "电脑端未检测到 cockpit-tools"}
              {status?.code === "not_installed" && "（需安装并运行 cockpit-tools）"}
            </span>
          </>
        )}
      </div>

      {/* 账号列表 */}
      {status?.connected && (
        <div className="cockpit-account-list">
          {accounts.map((account) => {
            const isCurrent = account.is_current || account.id === currentId;
            const isSwitchingTo =
              switchState.phase !== "idle" && switchState.account.id === account.id;
            const isRefreshing = refreshingId === account.id;
            return (
              <div
                key={account.id}
                className={`cockpit-account-row ${isCurrent ? "is-current" : ""} ${account.disabled ? "is-disabled" : ""}`}
                onClick={() => {
                  if (!isCurrent && !account.disabled && switchState.phase === "idle") {
                    setSwitchError(null);
                    setSwitchState({ phase: "confirming", account });
                  }
                }}
                role={isCurrent || account.disabled ? undefined : "button"}
                tabIndex={isCurrent || account.disabled ? -1 : 0}
              >
                <span className="cockpit-account-avatar">
                  <IconUser size={13} />
                </span>
                <div className="cockpit-account-info">
                  <span className="cockpit-account-email">{account.email}</span>
                  <span className="cockpit-account-meta">
                    {account.name ? `${account.name} · ` : ""}
                    {formatTier(account.subscription_tier) || "未知订阅"}
                    {account.disabled && " · 已禁用"}
                    {account.quota?.updatedAt
                      ? ` · 额度更新于 ${formatQuotaAge(account.quota.updatedAt)}`
                      : ""}
                  </span>
                  {(account.quota?.groups?.length ?? 0) > 0 && account.quota ? (
                    <div className="cockpit-quota-chips">
                      {groupChips(account.quota).map((chip) => (
                        <span
                          key={chip.key}
                          className={`cockpit-quota-chip is-${quotaLevel(chip.percent)}`}
                          title={chip.title}
                        >
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  ) : account.quota && account.quota.models.length > 0 ? (
                    <div className="cockpit-quota-chips">
                      {topModels(account.quota).map((model) => (
                        <span
                          key={model.name}
                          className={`cockpit-quota-chip is-${quotaLevel(model.remainingPercent)}`}
                          title={
                            model.resetTime
                              ? `重置时间：${model.resetTime}`
                              : undefined
                          }
                        >
                          {model.name} {model.remainingPercent}%
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="cockpit-quota-empty">暂无额度数据</span>
                  )}
                  {refreshError?.id === account.id && (
                    <span className="cockpit-quota-refresh-error">
                      {refreshError.message}
                    </span>
                  )}
                </div>
                <button
                  className="cockpit-quota-refresh-btn"
                  title="实时刷新此账号额度"
                  disabled={isRefreshing || !!refreshingId}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRefreshQuota(account);
                  }}
                >
                  {isRefreshing ? (
                    <IconSpinner size={13} className="icon-spin" />
                  ) : (
                    <IconRefresh size={13} />
                  )}
                </button>
                {isSwitchingTo ? (
                  <IconSpinner size={14} className="icon-spin" />
                ) : isCurrent ? (
                  <span className="cockpit-account-current-badge">
                    <IconCheck size={11} /> 当前
                  </span>
                ) : account.disabled ? null : (
                  <span className="cockpit-account-switch-hint">切换</span>
                )}
              </div>
            );
          })}
          {accounts.length === 0 && (
            <div className="cockpit-empty">cockpit-tools 中还没有账号</div>
          )}
        </div>
      )}

      {switchError && (
        <div className="cockpit-error" role="alert">
          切换失败：{switchError}
        </div>
      )}
      {switchedFlash && <div className="cockpit-success">✓ {switchedFlash}</div>}

      {/* 使用提示 */}
      {status?.connected && (
        <div className="cockpit-note">
          账号由电脑端 cockpit-tools 管理。切换由 cockpit-tools 完成（含凭据重写与
          Antigravity 重启），期间远控可能短暂中断并自动恢复。额度默认显示缓存快照
          （cockpit 按周期自动更新）；点每行的 ↻ 可用该账号的令牌实时向 Google 拉取
          （令牌只保留在代理端，不会传到手机）。
        </div>
      )}
      {status?.connected && (
        <button
          className="cockpit-btn is-refresh"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          刷新列表与额度
        </button>
      )}
      {loadError && !status?.connected && (
        <div className="cockpit-error">{loadError}</div>
      )}

      {/* 切换确认弹窗 */}
      {switchState.phase !== "idle" &&
        createPortal(
          <div
            className="cockpit-switch-modal-overlay"
            onClick={() => {
              if (switchState.phase === "confirming") {
                setSwitchState({ phase: "idle" });
              }
            }}
          >
            <div
              className="cockpit-switch-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="cockpit-switch-modal-title">
                {switchState.phase === "confirming" ? "切换账号" : "正在切换…"}
              </div>
              <div className="cockpit-switch-modal-email">
                {switchState.account.email}
              </div>
              {switchState.phase === "confirming" ? (
                <>
                  <div className="cockpit-switch-modal-desc">
                    将写入该账号的凭据并重启 Antigravity，期间远控会短暂中断并自动恢复。
                  </div>
                  <div className="cockpit-switch-modal-actions">
                    <button
                      className="cockpit-btn is-cancel"
                      onClick={() => setSwitchState({ phase: "idle" })}
                    >
                      取消
                    </button>
                    <button
                      className="cockpit-btn is-ok"
                      onClick={handleSwitch}
                      autoFocus
                    >
                      确认切换
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="cockpit-switch-modal-desc">
                    正在写入凭据并重启 Antigravity，请稍候（通常几秒到半分钟）…
                  </div>
                  <div className="cockpit-switch-modal-switching">
                    <IconSpinner size={15} className="icon-spin" />
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
