import { useMemo, useState } from "react";
import {
  IconBot,
  IconCircleCheck,
  IconAlertTriangle,
  IconSearch,
  IconX,
} from "./Icons";
import type { SubagentSession } from "../hooks/useSubagentViewer";
import { triggerHaptic } from "../utils/haptics";

interface Props {
  subagents: SubagentSession[];
  onSelectSubagent: (id: string) => void;
  onClose?: () => void;
  className?: string;
}

function formatSubagentRelativeTime(timestamp?: string, defaultDays = "1天"): string {
  if (!timestamp) return defaultDays;
  try {
    const diff = Date.now() - new Date(timestamp).getTime();
    if (isNaN(diff) || diff < 0) return defaultDays;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天`;
  } catch {
    return defaultDays;
  }
}

function cleanMarkdownSnippet(text?: string): string {
  if (!text) return "";
  return text
    .replace(/^#+\s+/gm, "")
    .replace(/[*`_~>]/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 160);
}

export function SubagentDirectoryView({
  subagents = [],
  onSelectSubagent,
  onClose,
  className = "",
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSubagents = useMemo(() => {
    if (!searchQuery.trim()) return subagents;
    const q = searchQuery.trim().toLowerCase();
    return subagents.filter(
      (s) =>
        s.role.toLowerCase().includes(q) ||
        s.typeName.toLowerCase().includes(q) ||
        (s.output && s.output.toLowerCase().includes(q)) ||
        s.prompt.toLowerCase().includes(q),
    );
  }, [subagents, searchQuery]);

  const runningSubagents = useMemo(
    () => filteredSubagents.filter((s) => s.status === "running"),
    [filteredSubagents],
  );

  const completedSubagents = useMemo(
    () => filteredSubagents.filter((s) => s.status === "completed" || s.status === "failed"),
    [filteredSubagents],
  );

  return (
    <div className={`subagent-directory-root ${className}`}>
      {/* Search Header (if subagents count > 4) */}
      {subagents.length > 4 && (
        <div className="subagent-dir-search-wrap">
          <IconSearch size={13} className="subagent-dir-search-icon" />
          <input
            type="text"
            className="subagent-dir-search-input"
            placeholder="搜索子智能体..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="subagent-dir-search-clear"
              onClick={() => setSearchQuery("")}
              title="清除搜索"
            >
              <IconX size={12} />
            </button>
          )}
        </div>
      )}

      <div className="subagent-dir-content-scroll">
        {/* Main Title (1:1 Matching Screenshot 2) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <h1 className="subagent-dir-title" style={{ margin: 0 }}>子智能体目录</h1>
          {onClose && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", padding: "4px" }}
              title="关闭目录"
            >
              <IconX size={16} />
            </button>
          )}
        </div>

        {/* Section 1: 正在运行 · N */}
        <div className="subagent-dir-section">
          <div className="subagent-dir-section-header">
            正在运行 · {runningSubagents.length}
          </div>

          {runningSubagents.length === 0 ? (
            <div className="subagent-dir-empty-text">没有正在运行的子智能体</div>
          ) : (
            <div className="subagent-dir-cards-list">
              {runningSubagents.map((s) => (
                <div
                  key={s.id}
                  className="subagent-dir-card is-running"
                  onClick={() => {
                    triggerHaptic("light");
                    onSelectSubagent(s.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="subagent-dir-card-top">
                    <div className="subagent-dir-card-left">
                      <IconBot size={14} className="subagent-dir-bot-icon is-spinning" />
                      <span className="subagent-dir-card-name">{s.role}</span>
                      <span className="subagent-dir-running-badge">执行中</span>
                    </div>
                    <span className="subagent-dir-card-time">
                      {formatSubagentRelativeTime(s.timestamp, "正在执行")}
                    </span>
                  </div>
                  {s.prompt && (
                    <div className="subagent-dir-card-snippet">
                      {cleanMarkdownSnippet(s.prompt)}...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: 已结束 · N */}
        <div className="subagent-dir-section">
          <div className="subagent-dir-section-header">
            已结束 · {completedSubagents.length}
          </div>

          {completedSubagents.length === 0 ? (
            <div className="subagent-dir-empty-text">暂无已结束的子智能体</div>
          ) : (
            <div className="subagent-dir-cards-list">
              {completedSubagents.map((s) => {
                const isFailed = s.status === "failed";
                const snippet = cleanMarkdownSnippet(s.output || s.prompt);

                return (
                  <div
                    key={s.id}
                    className={`subagent-dir-card ${isFailed ? "is-failed" : "is-completed"}`}
                    onClick={() => {
                      triggerHaptic("light");
                      onSelectSubagent(s.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="subagent-dir-card-top">
                      <div className="subagent-dir-card-left">
                        {isFailed ? (
                          <IconAlertTriangle size={14} className="subagent-dir-status-icon failed" />
                        ) : (
                          <IconCircleCheck size={14} className="subagent-dir-status-icon check" />
                        )}
                        <span className="subagent-dir-card-name" title={s.role}>
                          {s.role}
                        </span>
                        <span className={`subagent-dir-status-badge ${isFailed ? "failed" : "completed"}`}>
                          {isFailed ? "执行失败" : "已完成"}
                        </span>
                      </div>
                      <span className="subagent-dir-card-time">
                        {formatSubagentRelativeTime(s.timestamp, "1天")}
                      </span>
                    </div>

                    {snippet && (
                      <div className="subagent-dir-card-snippet">
                        {snippet}...
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
