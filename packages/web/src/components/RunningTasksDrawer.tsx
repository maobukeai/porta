import { useState, useEffect, useRef } from "react";
import type { RunningTask } from "../types";
import {
  IconX,
  IconTerminalSquare,
  IconStop,
  IconCopy,
  IconCheck,
} from "./Icons";
import { copyText } from "../utils/clipboard";
import { triggerHaptic } from "../utils/haptics";

interface RunningTasksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: RunningTask[];
  onTerminateTask?: (taskId: string) => void;
  onSendInput?: (taskId: string, input: string) => void;
  onOpenTerminal?: () => void;
  isMobile?: boolean;
}

export function RunningTasksDrawer({
  isOpen,
  onClose,
  tasks,
  onTerminateTask,
  onSendInput,
  onOpenTerminal,
  isMobile = false,
}: RunningTasksDrawerProps) {
  const [activeTab, setActiveTab] = useState<"running" | "all">("running");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [inputText, setInputText] = useState("");
  const logContainerRef = useRef<HTMLPreElement>(null);

  // Auto-select first running task or first task
  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "waiting");
  const filteredTasks = activeTab === "running" ? runningTasks : tasks;

  useEffect(() => {
    if (isOpen) {
      if (!selectedTaskId || !tasks.some((t) => t.id === selectedTaskId)) {
        setSelectedTaskId(runningTasks[0]?.id || tasks[0]?.id || null);
      }
    }
  }, [isOpen, tasks, runningTasks, selectedTaskId]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || runningTasks[0] || tasks[0];

  // Auto-scroll log output when content changes
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [selectedTask?.output, autoScroll]);

  if (!isOpen) return null;

  const handleCopyLogs = async () => {
    if (!selectedTask?.output) return;
    triggerHaptic("light");
    const ok = await copyText(selectedTask.output);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleTerminate = (taskId: string) => {
    triggerHaptic("heavy");
    onTerminateTask?.(taskId);
  };

  const handleSendInput = () => {
    const text = inputText;
    if (!text || !selectedTask || !onSendInput) return;
    triggerHaptic("light");
    onSendInput(selectedTask.id, text);
    setInputText("");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <span className="zcode-task-badge is-running">● 运行中</span>;
      case "completed":
        return <span className="zcode-task-badge is-done">✔ 已完成</span>;
      case "failed":
        return <span className="zcode-task-badge is-failed">✖ 失败</span>;
      case "terminated":
        return <span className="zcode-task-badge is-terminated">⏹ 已终止</span>;
      case "waiting":
        return <span className="zcode-task-badge is-waiting">⏳ 等待中</span>;
      default:
        return <span className="zcode-task-badge">{status}</span>;
    }
  };

  return (
    <div className="zcode-tasks-drawer-backdrop" onClick={onClose}>
      <div
        className={`zcode-tasks-drawer-panel ${isMobile ? "is-mobile-sheet" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="zcode-tasks-drawer-header">
          <div className="zcode-tasks-drawer-header-left">
            <span className="zcode-tasks-drawer-icon">
              <IconTerminalSquare size={16} />
            </span>
            <span className="zcode-tasks-drawer-title">后台任务管理</span>
            <span className="zcode-tasks-drawer-count-pill">
              {runningTasks.length} 运行中 / {tasks.length} 全部
            </span>
          </div>

          <div className="zcode-tasks-drawer-header-right">
            {onOpenTerminal && (
              <button
                type="button"
                className="zcode-tasks-drawer-btn"
                onClick={() => {
                  triggerHaptic("light");
                  onOpenTerminal();
                  onClose();
                }}
                title="打开交互式终端"
              >
                终端
              </button>
            )}
            <button
              type="button"
              className="zcode-tasks-drawer-close-btn"
              onClick={onClose}
              title="关闭"
              aria-label="关闭抽屉"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="zcode-tasks-tabs-bar">
          <button
            type="button"
            className={`zcode-tasks-tab-btn ${activeTab === "running" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("light");
              setActiveTab("running");
            }}
          >
            正在运行 ({runningTasks.length})
          </button>
          <button
            type="button"
            className={`zcode-tasks-tab-btn ${activeTab === "all" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("light");
              setActiveTab("all");
            }}
          >
            全部任务 ({tasks.length})
          </button>
        </div>

        {/* Content Body: Split list & Console on desktop, stacked on mobile */}
        <div className="zcode-tasks-drawer-body">
          {/* Task List */}
          <div className="zcode-tasks-list-pane">
            {filteredTasks.length === 0 ? (
              <div className="zcode-tasks-empty">
                <span>暂无{activeTab === "running" ? "正在运行的" : ""}任务</span>
              </div>
            ) : (
              filteredTasks.map((t) => (
                <div
                  key={t.id}
                  className={`zcode-task-list-item ${selectedTask?.id === t.id ? "selected" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    setSelectedTaskId(t.id);
                  }}
                >
                  <div className="zcode-task-item-top">
                    <span className="zcode-task-cmd" title={t.command}>
                      {t.displayCommand || t.command}
                    </span>
                    {getStatusBadge(t.status)}
                  </div>

                  <div className="zcode-task-item-bottom">
                    <span className="zcode-task-cwd" title={t.cwd}>
                      {t.cwd ? `📁 ${t.cwd.split(/[\\/]/).pop()}` : "根工作区"}
                    </span>
                    {t.status === "running" && onTerminateTask && (
                      <button
                        type="button"
                        className="zcode-task-stop-inline-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTerminate(t.id);
                        }}
                        title="终止任务"
                        aria-label="终止任务"
                      >
                        <IconStop size={11} />
                        <span>终止</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Log Console Output Pane */}
          {selectedTask && (
            <div className="zcode-tasks-console-pane">
              <div className="zcode-console-header">
                <div className="zcode-console-title-wrap">
                  <span className="zcode-console-cmd-title" title={selectedTask.command}>
                    $ {selectedTask.command}
                  </span>
                </div>

                <div className="zcode-console-actions">
                  <button
                    type="button"
                    className={`zcode-console-action-btn ${autoScroll ? "active" : ""}`}
                    onClick={() => setAutoScroll((v) => !v)}
                    title={autoScroll ? "已开启自动滚底" : "已暂停自动滚底"}
                  >
                    自动滚动
                  </button>
                  <button
                    type="button"
                    className="zcode-console-action-btn"
                    onClick={handleCopyLogs}
                    title="复制日志"
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    <span>{copied ? "已复制" : "复制"}</span>
                  </button>
                  {selectedTask.status === "running" && onTerminateTask && (
                    <button
                      type="button"
                      className="zcode-console-action-btn stop"
                      onClick={() => handleTerminate(selectedTask.id)}
                      title="终止任务"
                      aria-label="终止任务"
                    >
                      <IconStop size={12} />
                      <span>终止任务</span>
                    </button>
                  )}
                </div>
              </div>

              <pre
                className="zcode-console-output-box"
                ref={logContainerRef}
                tabIndex={0}
              >
                {selectedTask.output || (
                  <span className="zcode-console-placeholder">
                    {selectedTask.status === "running"
                      ? "任务正在后台执行中，等待输出流..."
                      : "此命令未产生输出或输出为空"}
                  </span>
                )}
              </pre>

              {selectedTask.status === "running" && onSendInput && (
                <div
                  className="zcode-console-input-row"
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px" }}
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleSendInput();
                      }
                    }}
                    placeholder="向此任务发送输入 (stdin)…"
                    aria-label="发送输入到任务"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 32,
                      padding: "0 10px",
                      fontSize: 12.5,
                      fontFamily: "var(--font-mono)",
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-default)",
                      borderRadius: 6,
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    className="zcode-console-action-btn"
                    onClick={handleSendInput}
                    disabled={!inputText.trim()}
                    title="发送输入"
                    style={{ height: 32, flexShrink: 0 }}
                  >
                    发送
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
