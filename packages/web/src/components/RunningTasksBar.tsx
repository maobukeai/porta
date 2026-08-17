import { useState, useRef, useEffect } from "react";
import type { RunningTask } from "../types";
import { IconChevron, IconStop } from "./Icons";
import { triggerHaptic } from "../utils/haptics";

interface RunningTasksBarProps {
  runningTasks: RunningTask[];
  onOpenDrawer: () => void;
  onTerminateTask?: (taskId: string) => void;
  className?: string;
  isMobile?: boolean;
}

export function RunningTasksBar({
  runningTasks,
  onOpenDrawer,
  onTerminateTask,
  className = "",
  isMobile = false,
}: RunningTasksBarProps) {
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const stopResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stopResetTimerRef.current !== null) {
        clearTimeout(stopResetTimerRef.current);
      }
    };
  }, []);

  if (!runningTasks || runningTasks.length === 0) {
    return null;
  }

  const primaryTask = runningTasks[0];
  const count = runningTasks.length;
  const countLabel = count === 1 ? "1 task running" : `${count} tasks running`;
  const commandText = primaryTask.displayCommand || primaryTask.command || "cargo run";

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onTerminateTask || !primaryTask) return;
    triggerHaptic("heavy");
    setStoppingId(primaryTask.id);
    onTerminateTask(primaryTask.id);
    if (stopResetTimerRef.current !== null) {
      clearTimeout(stopResetTimerRef.current);
    }
    stopResetTimerRef.current = setTimeout(() => setStoppingId(null), 1000);
  };

  const handleBarClick = () => {
    triggerHaptic("light");
    onOpenDrawer();
  };

  return (
    <div
      className={`zcode-running-tasks-bar-root ${isMobile ? "is-mobile" : ""} ${className}`}
      onClick={handleBarClick}
      role="button"
      tabIndex={0}
      title="点击查看后台任务输出与管理"
      aria-label={`${countLabel}: ${commandText}`}
    >
      <div className="zcode-running-tasks-bar-container">
        {/* Left Side: Header & Command with Spinner */}
        <div className="zcode-running-tasks-content">
          <div className="zcode-running-tasks-header-row">
            <span className="zcode-running-tasks-count-label">{countLabel}</span>
          </div>

          <div className="zcode-running-tasks-command-row">
            <span className="zcode-running-tasks-spinner" aria-hidden="true" />
            <span className="zcode-running-tasks-cmd-text" title={primaryTask.command}>
              {commandText}
            </span>
          </div>
        </div>

        {/* Right Side: Quick Stop & Chevron */}
        <div className="zcode-running-tasks-actions">
          {onTerminateTask && (
            <button
              type="button"
              className={`zcode-running-task-quick-stop-btn ${stoppingId === primaryTask.id ? "stopping" : ""}`}
              onClick={handleStop}
              title="终止当前后台任务"
              aria-label="终止当前后台任务"
            >
              <IconStop size={12} />
            </button>
          )}

          <span className="zcode-running-tasks-chevron">
            <IconChevron size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}
