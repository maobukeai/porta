import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { IconSpinner, IconZap } from "./Icons";
import type { SystemDiagnostics } from "../types";

interface Props {
  /** Called when the Language Server is back online (auto-hides the overlay). */
  onRecovered: () => void;
  /** Called when the user chooses to browse history instead of relaunching. */
  onDismiss: () => void;
}

/** Poll diagnostics while the overlay is open; faster while awaiting relaunch. */
const IDLE_POLL_MS = 5_000;
const WAITING_POLL_MS = 2_000;

type StatusRow = {
  label: string;
  ok: boolean | "pending";
  detail: string;
};

export function AntigravityDiagnostics({ onRecovered, onDismiss }: Props) {
  const [info, setInfo] = useState<SystemDiagnostics | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [waitingReconnect, setWaitingReconnect] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const recoveredRef = useRef(false);
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  const runDiagnostics = useCallback(async () => {
    try {
      const data = await api.systemDiagnostics();
      setFetchError(null);
      setInfo(data);
      if (data.languageServers.length > 0 && !recoveredRef.current) {
        recoveredRef.current = true;
        onRecoveredRef.current();
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics, refreshTick]);

  useEffect(() => {
    const interval = setInterval(
      () => {
        if (!document.hidden) void runDiagnostics();
      },
      waitingReconnect ? WAITING_POLL_MS : IDLE_POLL_MS,
    );
    return () => clearInterval(interval);
  }, [runDiagnostics, waitingReconnect]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await api.launchAntigravity();
      if (res.started) {
        setWaitingReconnect(true);
      } else if (res.reason === "language-server-already-running") {
        // LS came back between polls — the next poll will trigger recovery.
        setWaitingReconnect(true);
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }, []);

  const handleRediagnose = useCallback(() => {
    setLaunchError(null);
    setRefreshTick((n) => n + 1);
  }, []);

  const lsCount = info?.languageServers.length ?? 0;
  const ag = info?.antigravity;

  const rows: StatusRow[] = info
    ? [
        {
          label: "中转代理",
          ok: true,
          detail: `连接正常 · 端口 ${info.proxy.port}`,
        },
        {
          label: "Antigravity 桌面端",
          ok: ag?.processRunning ?? false,
          detail: ag?.processRunning
            ? `运行中（${ag.pids.length} 个进程）`
            : "未运行",
        },
        {
          label: "Language Server",
          ok: lsCount > 0,
          detail:
            lsCount > 0
              ? `已连接 ${lsCount} 个实例`
              : ag?.processRunning
                ? "等待启动中…"
                : "未发现（随 Antigravity 一起退出）",
        },
      ]
    : [];

  const canLaunch =
    !!ag?.launchable && !launching && lsCount === 0 && !fetchError;

  return createPortal(
    <div className="ag-diag-overlay">
      <div className="ag-diag-card">
        <div className="ag-diag-header">
          <span className="ag-diag-badge">
            <IconZap size={15} />
          </span>
          <div className="ag-diag-titles">
            <h2 className="ag-diag-title">无法连接 Antigravity</h2>
            <p className="ag-diag-subtitle">
              桌面端 Antigravity 已关闭，Language Server 随之停止。
              可在下方重新打开并自动恢复连接。
            </p>
          </div>
        </div>

        <div className="ag-diag-rows" data-testid="ag-diag-rows">
          {fetchError && (
            <div className="ag-diag-row is-error">
              <span className="ag-diag-row-icon">!</span>
              <div className="ag-diag-row-body">
                <span className="ag-diag-row-label">诊断请求失败</span>
                <span className="ag-diag-row-detail">{fetchError}</span>
              </div>
            </div>
          )}
          {rows.map((row) => (
            <div
              key={row.label}
              className={`ag-diag-row ${row.ok ? "is-ok" : "is-bad"}`}
            >
              <span className="ag-diag-row-icon">
                {row.ok ? "✓" : "✕"}
              </span>
              <div className="ag-diag-row-body">
                <span className="ag-diag-row-label">{row.label}</span>
                <span className="ag-diag-row-detail">{row.detail}</span>
              </div>
            </div>
          ))}
          {info && (
            <div className="ag-diag-row is-neutral">
              <span className="ag-diag-row-icon">ⓘ</span>
              <div className="ag-diag-row-body">
                <span className="ag-diag-row-label">启动方式</span>
                <span className="ag-diag-row-detail">
                  {ag?.launchMethod === "bat" && `启动脚本：${ag.batPath}`}
                  {ag?.launchMethod === "exe" &&
                    `直接启动：${ag.idePath ?? "Antigravity.exe"}`}
                  {!ag?.launchMethod &&
                    "未配置（需在 .env 设置 PORTA_ANTIGRAVITY_LAUNCH_BAT）"}
                </span>
              </div>
            </div>
          )}
        </div>

        {launchError && (
          <div className="ag-diag-error" role="alert">
            启动失败：{launchError}
          </div>
        )}

        <div className="ag-diag-actions">
          <button
            className="ag-diag-btn is-secondary"
            onClick={handleRediagnose}
            disabled={launching}
          >
            重新诊断
          </button>
          <button
            className="ag-diag-btn is-primary"
            onClick={handleLaunch}
            disabled={!canLaunch}
          >
            {launching ? (
              <>
                <IconSpinner size={14} className="icon-spin" /> 正在启动…
              </>
            ) : waitingReconnect ? (
              <>
                <IconSpinner size={14} className="icon-spin" /> 等待 Language
                Server 上线…
              </>
            ) : (
              "重新打开 Antigravity"
            )}
          </button>
        </div>

        <p className="ag-diag-note">
          关闭 Antigravity 时进行中的任务已被终止，重新打开后可从历史会话继续。
        </p>
        <button className="ag-diag-dismiss" onClick={onDismiss}>
          暂不处理，浏览历史会话 →
        </button>
      </div>
    </div>,
    document.body,
  );
}
