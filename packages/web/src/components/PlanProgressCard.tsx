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
    subagents,
    content,
    refresh,
    loading,
  } = planData;

  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [showPendingPopover, setShowPendingPopover] = useState(false);
  const [showSubagentsPopover, setShowSubagentsPopover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverBtnRef = useRef<HTMLButtonElement>(null);
  const subagentsPopoverRef = useRef<HTMLDivElement>(null);
  const subagentsBtnRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const runningSubagents = subagentSessions.filter((s) => s.status === "running");
  const completedSubagents = subagentSessions.filter(
    (s) => s.status === "completed" || s.status === "failed",
  );
  const totalSubagentsCount = Math.max(subagents.total, subagentSessions.length);
  const completedSubagentsCount = Math.max(
    subagents.completed,
    completedSubagents.length,
  );
  const hasSubagents = totalSubagentsCount > 0 || subagentSessions.length > 0;
  const hasTasks = Boolean(hasPlan && total > 0);

  // Close menus when clicking outside
  useEffect(() => {
    if (!showPendingPopover && !menuOpen && !showSubagentsPopover) return;

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
      if (
        showSubagentsPopover &&
        subagentsPopoverRef.current &&
        !subagentsPopoverRef.current.contains(target) &&
        subagentsBtnRef.current &&
        !subagentsBtnRef.current.contains(target)
      ) {
        setShowSubagentsPopover(false);
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
  }, [showPendingPopover, menuOpen, showSubagentsPopover]);

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
          {hasTasks
            ? `进程 ${completedCount}/${total}`
            : `智能体 ${completedSubagentsCount}/${totalSubagentsCount}`}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`zcode-plan-card-root ${isMobile ? "is-mobile-view" : ""} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Header Bar: 进程 1/7 or 智能体 + Actions */}
      <div className="zcode-plan-header">
        <div className="zcode-plan-header-left">
          <span className="zcode-plan-title-label">
            {hasTasks ? "进程" : "智能体"}
          </span>
          <span className="zcode-plan-progress-ratio">
            {hasTasks
              ? `${completedCount}/${total}`
              : `${completedSubagentsCount}/${totalSubagentsCount}`}
          </span>
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

      {/* 2. Tasks Container */}
      <div className="zcode-plan-tasks-body">
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

        {/* Active Running Subagents in Taskbar (With Spinning Bot Icon & Click to Enter) */}
        {runningSubagents.length > 0 && (
          <div className="zcode-plan-running-subagents-section">
            {runningSubagents.map((s) => (
              <div
                key={s.id}
                className="zcode-plan-task-row is-subagent-running"
                onClick={() => {
                  triggerHaptic("light");
                  onSelectSubagent?.(s.id);
                }}
                role="button"
                tabIndex={0}
                title={`子智能体正在执行: ${s.role}，点击进入会话`}
              >
                <div className="zcode-plan-running-bot-wrap">
                  <IconBot size={13} className="subagent-running-bot-icon" />
                  <span className="subagent-running-spinner-ring" />
                </div>
                <span className="zcode-plan-task-text current subagent-running-text" title={s.role}>
                  {s.role}
                </span>
                <span className="zcode-plan-subagent-running-tag">运行中</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Bottom Subagents Status Row (Collapses when ended / completed) */}
      {hasSubagents && (completedSubagentsCount > 0 || completedSubagents.length > 0 || runningSubagents.length === 0) && (
        <div className="zcode-plan-subagents-container">
          <div
            ref={subagentsBtnRef}
            className={`zcode-plan-subagents-bar ${showSubagentsPopover ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("light");
              if (subagentSessions.length > 0) {
                setShowSubagentsPopover((v) => !v);
              } else if (onOpenSubagents) {
                onOpenSubagents();
              }
            }}
            role="button"
            tabIndex={0}
            title="查看关联智能体状态"
          >
            <div className="zcode-plan-subagents-left">
              <span className="zcode-plan-subagents-label">智能体</span>
            </div>
            <div className="zcode-plan-subagents-right">
              <IconCircleCheck size={13} className="zcode-plan-subagents-check" />
              <span className="zcode-plan-subagents-status">
                已结束 {completedSubagentsCount || completedSubagents.length}
              </span>
              <IconChevronRight size={11} className="zcode-plan-subagents-chevron" />
            </div>
          </div>

          {/* Subagents List Popover (1:1 matching screenshot 1) */}
          {showSubagentsPopover && subagentSessions.length > 0 && (
            <div ref={subagentsPopoverRef} className="zcode-plan-subagents-popover">
              <div className="zcode-plan-subagents-popover-header">
                <span>子智能体 ({subagentSessions.length})</span>
                {onOpenSubagents && (
                  <button
                    className="zcode-plan-subagents-dir-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSubagents();
                      setShowSubagentsPopover(false);
                    }}
                  >
                    目录 →
                  </button>
                )}
              </div>
              <div className="zcode-plan-subagents-popover-list">
                {subagentSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`zcode-subagent-list-item ${s.status === "failed" ? "is-failed" : ""} ${s.status === "running" ? "is-running" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      onSelectSubagent?.(s.id);
                      setShowSubagentsPopover(false);
                    }}
                  >
                    <div className="subagent-item-left-icon">
                      <IconBot
                        size={13}
                        className={`subagent-item-bot-icon ${s.status === "running" ? "is-spinning" : ""}`}
                      />
                      {s.status === "running" && <span className="subagent-dot-pulse" />}
                    </div>
                    <span className="subagent-item-prefix">子智能体</span>
                    <span className="subagent-item-typename">{s.typeName}</span>
                    <span className="subagent-item-sep">·</span>
                    <span className="subagent-item-role" title={s.role}>
                      {s.role}
                    </span>
                    {s.status === "running" && (
                      <span className="subagent-item-running-tag">执行中</span>
                    )}
                    {s.status === "failed" && (
                      <span className="subagent-item-failed-tag">执行失败</span>
                    )}
                    {s.status === "completed" && (
                      <span className="subagent-item-done-tag">已完成</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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

  const count = hasTasks
    ? `${planData.completedCount}/${planData.total}`
    : `${planData.subagents.completed}/${planData.subagents.total}`;

  return (
    <button
      className="zcode-plan-header-capsule"
      onClick={() => {
        triggerHaptic("light");
        onClick();
      }}
      title={`任务规划进展: ${count}`}
      aria-label="查看任务规划进展"
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
