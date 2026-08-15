import React, { useState, useRef, useEffect } from "react";
import {
  IconMoreHorizontal,
  IconArrowUpRight,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconCircle,
  IconCircleCheck,
  IconRefresh,
  IconCopy,
  IconCheck,
  IconBot,
  IconAlertTriangle,
} from "./Icons";
import type { PlanProgressData } from "../hooks/usePlanTracker";
import type { SubagentSession } from "../hooks/useSubagentViewer";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";

interface Props {
  planData: PlanProgressData;
  subagentSessions?: SubagentSession[];
  onOpenPlanDetail?: () => void;
  onOpenSubagents?: () => void;
  onSelectSubagent?: (id: string) => void;
  className?: string;
  isMobile?: boolean;
}

export function PlanProgressCard({
  planData,
  subagentSessions = [],
  onOpenPlanDetail,
  onOpenSubagents,
  onSelectSubagent,
  className = "",
  isMobile = false,
}: Props) {
  const {
    hasPlan,
    total,
    completedCount,
    completedSteps,
    currentStep,
    upcomingSteps,
    overflowSteps,
    subagents: _subagents,
    content,
    refresh,
    loading,
  } = planData;

  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [showPendingPopover, setShowPendingPopover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const runningSubagents = subagentSessions.filter((s) => s.status === "running");
  const completedSubagents = subagentSessions.filter(
    (s) => s.status === "completed" || s.status === "failed",
  );
  const totalSubagentsCount = subagentSessions.length;
  const completedSubagentsCount = completedSubagents.length;
  const hasSubagents = totalSubagentsCount > 0;
  const hasTasks = Boolean(hasPlan && total > 0);

  // Close menus when clicking outside
  useEffect(() => {
    if (!showPendingPopover && !menuOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        showPendingPopover &&
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        popoverBtnRef.current &&
        !popoverBtnRef.current.contains(target)
      ) {
        setShowPendingPopover(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showPendingPopover, menuOpen]);

  // If no active plan tasks AND no subagents, do NOT render anything
  if (!hasTasks && !hasSubagents) {
    return null;
  }

  const handleCopyPlan = async () => {
    triggerHaptic("light");
    const textToCopy =
      content ||
      planData.tasks
        .map((t) => `- [${t.status === "completed" ? "x" : " "}] ${t.title}`)
        .join("\n");
    await copyText(textToCopy);
    setCopiedToast(true);
    setMenuOpen(false);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const handleToggleCompleted = () => {
    triggerHaptic("light");
    setCompletedExpanded((v) => !v);
  };

  const handleTogglePendingPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("light");
    setShowPendingPopover((v) => !v);
  };

  const headerLabel =
    hasTasks && hasSubagents
      ? "任务与智能体"
      : hasTasks
        ? "进程"
        : "智能体";

  const headerRatio =
    hasTasks && hasSubagents
      ? `${completedCount}/${total} · 🤖${completedSubagentsCount}/${totalSubagentsCount}`
      : hasTasks
        ? `${completedCount}/${total}`
        : `${completedSubagentsCount}/${totalSubagentsCount}`;

  // Minimized Floating Badge mode
  if (minimized) {
    return (
      <div
        className={`zcode-plan-minimized-badge ${className}`}
        onClick={() => setMinimized(false)}
      >
        <span className="zcode-plan-min-icon">
          {runningSubagents.length > 0 ? "🤖" : "⚡"}
        </span>
        <span className="zcode-plan-min-text">
          {headerLabel} {headerRatio}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`zcode-plan-card-root ${isMobile ? "is-mobile-view" : ""} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Header Bar */}
      <div className="zcode-plan-header">
        <div className="zcode-plan-header-left">
          <span className="zcode-plan-title-label">{headerLabel}</span>
          <span className="zcode-plan-progress-ratio">{headerRatio}</span>
        </div>

        <div className="zcode-plan-header-actions" ref={menuRef}>
          {/* More options button */}
          <button
            className={`zcode-plan-btn-icon ${menuOpen ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("light");
              setMenuOpen((v) => !v);
            }}
            title="更多操作"
            aria-label="更多操作"
          >
            <IconMoreHorizontal size={14} />
          </button>

          {/* Expand to full plan document / Subagent Directory */}
          <button
            className="zcode-plan-btn-icon"
            onClick={() => {
              triggerHaptic("medium");
              if (hasTasks && onOpenPlanDetail) {
                onOpenPlanDetail();
              } else if (onOpenSubagents) {
                onOpenSubagents();
              } else if (onOpenPlanDetail) {
                onOpenPlanDetail();
              }
            }}
            title={hasTasks ? "查看完整规划文档" : "查看子智能体目录"}
            aria-label={hasTasks ? "查看完整规划文档" : "查看子智能体目录"}
          >
            <IconArrowUpRight size={14} />
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="zcode-plan-dropdown-menu">
              <button
                className="zcode-plan-dropdown-item"
                onClick={() => {
                  triggerHaptic("light");
                  void refresh();
                  setMenuOpen(false);
                }}
              >
                <IconRefresh size={12} className={loading ? "icon-spin" : ""} />
                <span>刷新规划进展</span>
              </button>

              {hasTasks && (
                <button
                  className="zcode-plan-dropdown-item"
                  onClick={handleCopyPlan}
                >
                  <IconCopy size={12} />
                  <span>复制规划文本</span>
                </button>
              )}

              {onOpenSubagents && (
                <button
                  className="zcode-plan-dropdown-item"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenSubagents();
                    setMenuOpen(false);
                  }}
                >
                  <IconBot size={12} />
                  <span>打开子智能体目录</span>
                </button>
              )}

              <button
                className="zcode-plan-dropdown-item"
                onClick={() => {
                  triggerHaptic("light");
                  setMinimized(true);
                  setMenuOpen(false);
                }}
              >
                <span>最小化面板</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Copy Toast feedback */}
      {copiedToast && (
        <div className="zcode-plan-toast">
          <IconCheck size={12} />
          <span>已复制规划内容</span>
        </div>
      )}

      {/* 2. Unified Content Body: Tasks (Top) + Subagents (Bottom) */}
      <div className="zcode-plan-tasks-body">
        {/* ── Section A: Tasks List (if hasTasks) ── */}
        {hasTasks && (
          <div className="zcode-plan-tasks-section">
            {/* Completed Group Accordion */}
            {completedCount > 0 && (
              <div className="zcode-plan-completed-group">
                <button
                  className="zcode-plan-group-toggle"
                  onClick={handleToggleCompleted}
                  title={completedExpanded ? "折叠已完成" : "展开已完成"}
                >
                  {completedExpanded ? (
                    <IconChevronDown size={10} className="zcode-plan-toggle-chevron" />
                  ) : (
                    <IconChevronRight size={10} className="zcode-plan-toggle-chevron" />
                  )}
                  <span className="zcode-plan-group-label">已完成 {completedCount} 项</span>
                </button>

                {completedExpanded && (
                  <div className="zcode-plan-completed-list">
                    {completedSteps.map((task) => (
                      <div key={task.id} className="zcode-plan-task-row is-completed">
                        <span className="zcode-plan-task-check">
                          <IconCircleCheck size={13} />
                        </span>
                        {task.icon && (
                          <span className="zcode-plan-task-emoji">{task.icon}</span>
                        )}
                        <span className="zcode-plan-task-text" title={task.title}>
                          {task.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Current In-Progress Step (Highlighted) */}
            {currentStep && (
              <div className="zcode-plan-task-row is-running">
                <span className="zcode-plan-task-arrow">→</span>
                {currentStep.icon && (
                  <span className="zcode-plan-task-emoji">{currentStep.icon}</span>
                )}
                <span className="zcode-plan-task-text current" title={currentStep.title}>
                  {currentStep.title}
                </span>
              </div>
            )}

            {/* Upcoming Pending Steps (First 2) */}
            {upcomingSteps.map((task) => (
              <div key={task.id} className="zcode-plan-task-row is-pending">
                <span className="zcode-plan-task-circle">
                  <IconCircle size={12} />
                </span>
                {task.icon && (
                  <span className="zcode-plan-task-emoji">{task.icon}</span>
                )}
                <span className="zcode-plan-task-text" title={task.title}>
                  {task.title}
                </span>
              </div>
            ))}

            {/* Overflow Pending Group Trigger */}
            {overflowSteps.length > 0 && (
              <div className="zcode-plan-overflow-container">
                <button
                  ref={popoverBtnRef}
                  className={`zcode-plan-group-toggle overflow-btn ${showPendingPopover ? "active" : ""}`}
                  onClick={handleTogglePendingPopover}
                  title="查看更多待处理任务"
                >
                  {showPendingPopover ? (
                    <IconChevronLeft size={10} className="zcode-plan-toggle-chevron" />
                  ) : (
                    <IconChevronRight size={10} className="zcode-plan-toggle-chevron" />
                  )}
                  <span className="zcode-plan-group-label">待处理 {overflowSteps.length} 项</span>
                </button>

                {/* Overflow Popover Balloon */}
                {showPendingPopover && (
                  <div ref={popoverRef} className="zcode-plan-popover">
                    <div className="zcode-plan-popover-header">
                      <span>待处理 {overflowSteps.length} 项</span>
                    </div>
                    <div className="zcode-plan-popover-list">
                      {overflowSteps.map((task) => (
                        <div key={task.id} className="zcode-plan-task-row is-pending">
                          <span className="zcode-plan-task-circle">
                            <IconCircle size={12} />
                          </span>
                          {task.icon && (
                            <span className="zcode-plan-task-emoji">{task.icon}</span>
                          )}
                          <span className="zcode-plan-task-text" title={task.title}>
                            {task.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Section B: Subagents Nodes List (if hasSubagents) ── */}
        {hasSubagents && (
          <div className="zcode-plan-subagents-section">
            {/* Section Divider if tasks exist above */}
            {hasTasks && (
              <div className="zcode-plan-section-divider">
                <span className="zcode-plan-divider-label">
                  子智能体 ({subagentSessions.length || totalSubagentsCount})
                </span>
                {onOpenSubagents && (
                  <button
                    className="zcode-plan-divider-dir-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSubagents();
                    }}
                    title="打开子智能体目录"
                  >
                    目录 →
                  </button>
                )}
              </div>
            )}

            {/* List of Subagents Directly Visible */}
            <div className="zcode-plan-subagents-list">
              {subagentSessions.map((s) => {
                const isRunning = s.status === "running";
                const isFailed = s.status === "failed";

                return (
                  <div
                    key={s.id}
                    className={`zcode-plan-task-row is-subagent-item ${isRunning ? "is-subagent-running" : isFailed ? "is-subagent-failed" : "is-subagent-done"}`}
                    onClick={() => {
                      triggerHaptic("light");
                      onSelectSubagent?.(s.id);
                    }}
                    role="button"
                    tabIndex={0}
                    title={`点击进入子智能体: ${s.role}`}
                  >
                    <div className="zcode-plan-subagent-icon-wrap">
                      {isRunning ? (
                        <>
                          <IconBot size={13} className="subagent-running-bot-icon" />
                          <span className="subagent-running-spinner-ring" />
                        </>
                      ) : isFailed ? (
                        <IconAlertTriangle size={13} className="subagent-failed-icon" />
                      ) : (
                        <IconCircleCheck size={13} className="zcode-plan-task-check" />
                      )}
                    </div>

                    <span
                      className={`zcode-plan-task-text subagent-item-role-text ${isRunning ? "current" : ""}`}
                      title={s.role}
                    >
                      {s.role}
                    </span>

                    <span
                      className={`zcode-plan-subagent-badge ${isRunning ? "running" : isFailed ? "failed" : "done"}`}
                    >
                      {isRunning ? "运行中" : isFailed ? "失败" : "已完成"}
                    </span>
                  </div>
                );
              })}

              {/* Fallback if subagentSessions is empty but count is registered */}
              {subagentSessions.length === 0 && totalSubagentsCount > 0 && (
                <div
                  className="zcode-plan-task-row is-subagent-item is-subagent-done"
                  onClick={() => {
                    triggerHaptic("light");
                    onOpenSubagents?.();
                  }}
                  role="button"
                  tabIndex={0}
                  title="查看子智能体列表"
                >
                  <IconBot size={13} style={{ color: "#818cf8" }} />
                  <span className="zcode-plan-task-text">已记录 {totalSubagentsCount} 个子智能体</span>
                  <span className="zcode-plan-subagent-badge done">查看</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Bottom Subagents Directory Bar */}
      {hasSubagents && onOpenSubagents && (
        <div
          className="zcode-plan-subagents-bottom-bar"
          onClick={() => {
            triggerHaptic("light");
            onOpenSubagents();
          }}
          role="button"
          tabIndex={0}
          title="打开子智能体目录"
        >
          <div className="zcode-plan-subagents-left">
            <IconBot size={13} style={{ color: "#818cf8" }} />
            <span className="zcode-plan-subagents-label">子智能体目录</span>
          </div>
          <div className="zcode-plan-subagents-right">
            <span className="zcode-plan-subagents-status">
              共 {subagentSessions.length || totalSubagentsCount} 个
            </span>
            <IconChevronRight size={11} className="zcode-plan-subagents-chevron" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight Header Capsule for Mobile Screen Top Bar
 */
export function PlanProgressCapsule({
  planData,
  onClick,
}: {
  planData: PlanProgressData;
  onClick: () => void;
}) {
  const hasSubagents = planData.subagents.total > 0;
  const hasTasks = planData.hasPlan && planData.total > 0;
  if (!hasTasks && !hasSubagents) return null;

  const count =
    hasTasks && hasSubagents
      ? `${planData.completedCount}/${planData.total} (🤖${planData.subagents.completed}/${planData.subagents.total})`
      : hasTasks
        ? `${planData.completedCount}/${planData.total}`
        : `${planData.subagents.completed}/${planData.subagents.total}`;

  return (
    <button
      className="zcode-plan-header-capsule"
      onClick={() => {
        triggerHaptic("light");
        onClick();
      }}
      title={`任务与智能体进展: ${count}`}
      aria-label="查看任务与智能体进展"
    >
      <span className="zcode-plan-capsule-icon">
        {planData.subagents.active > 0 ? "🤖" : "⚡"}
      </span>
      <span className="zcode-plan-capsule-ratio">{count}</span>
      {planData.subagents.active > 0 && (
        <span className="zcode-plan-capsule-spin-indicator" />
      )}
      {planData.currentStep?.icon && (
        <span className="zcode-plan-capsule-emoji">{planData.currentStep.icon}</span>
      )}
    </button>
  );
}
