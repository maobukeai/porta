import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import {
  IconBot,
  IconX,
  IconChevronDown,
  IconChevron,
  IconArrowLeft,
  IconMoreHorizontal,
  IconPencil,
  IconPin,
  IconArchive,
  IconCopy,
} from "./Icons";
import type { SubagentSession } from "../hooks/useSubagentViewer";
import { stepsToMessages } from "../transforms/stepsToMessages";
import { groupMessagesIntoTurns, MessageBubble, TurnStepsCollapsible } from "./ChatPanel";
import { TurnSummaryCard } from "./TurnSummaryCard";
import { extractTurnSummary } from "../utils/extractTurnSummary";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";
import { useStepsStream } from "../hooks/useStepsStream";
import type { ChatMessage, TrajectoryStep } from "../types";

interface Props {
  subagent: SubagentSession;
  allSubagents?: SubagentSession[];
  onSelectSubagent?: (id: string) => void;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  onOpenReview?: () => void;
  onClose: () => void;
}

export function SubagentDetailViewer({
  subagent,
  allSubagents = [],
  onSelectSubagent,
  onOpenFile,
  onOpenReview,
  onClose,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copySubmenuOpen, setCopySubmenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close more menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCopySubmenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleCopy = async (text: string, label: string) => {
    triggerHaptic("light");
    const ok = await copyText(text);
    if (ok) {
      showToast(`已复制 ${label}`);
    }
    setMenuOpen(false);
    setCopySubmenuOpen(false);
  };

  // If subagent has a dedicated child conversationId, stream its live/historical steps directly
  const { steps: streamedSteps } = useStepsStream(subagent.conversationId || "");

  const effectiveSteps: TrajectoryStep[] = useMemo(() => {
    if (streamedSteps && streamedSteps.length > 0) {
      return streamedSteps;
    }
    if (subagent.rawSteps && subagent.rawSteps.length > 0) {
      return subagent.rawSteps;
    }
    return [];
  }, [streamedSteps, subagent.rawSteps]);

  // Convert trajectory steps to standard chat messages
  const rawMessages = useMemo(() => {
    if (effectiveSteps.length > 0) {
      return stepsToMessages(effectiveSteps);
    }
    return [];
  }, [effectiveSteps]);

  // Ensure full chat stream has a user instruction message at the beginning
  const fullMessages = useMemo<ChatMessage[]>(() => {
    const list = [...rawMessages];
    const hasUser = list.some((m) => m.role === "user");
    if (!hasUser && subagent.prompt) {
      list.unshift({
        role: "user",
        content: subagent.prompt,
        stepIndex: 0,
        type: "USER_INPUT",
      });
    }
    // If no assistant message was found from steps but subagent.output exists, append it
    const hasAssistant = list.some((m) => m.role === "assistant" && m.content);
    if (!hasAssistant && subagent.output) {
      list.push({
        role: "assistant",
        content: subagent.output,
        stepIndex: list.length > 0 ? (list[list.length - 1].stepIndex ?? 0) + 1 : 1,
        type: "PLANNER_RESPONSE",
      });
    }
    return list;
  }, [rawMessages, subagent.prompt, subagent.output]);

  // Group messages into standard turns exactly matching ChatPanel
  const turns = useMemo(() => {
    return groupMessagesIntoTurns(fullMessages, subagent.status === "running");
  }, [fullMessages, subagent.status]);

  return (
    <div className="zcode-subagent-viewer-root" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="zcode-subagent-toast"
          style={{
            position: "absolute",
            top: 48,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(34, 197, 94, 0.95)",
            color: "#ffffff",
            padding: "4px 12px",
            borderRadius: "16px",
            fontSize: "12px",
            fontWeight: 500,
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* 1. Top Subagent Tab Bar (1:1 matching desktop client) */}
      <div className="zcode-subagent-tabs-header">
        <div className="zcode-subagent-tabs-left">
          {allSubagents.length > 1 && (
            <div className="zcode-subagent-tab-dropdown-wrap">
              <button
                className={`zcode-subagent-tab-btn dropdown-toggle ${dropdownOpen ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic("light");
                  setDropdownOpen((v) => !v);
                }}
                title="切换子智能体"
              >
                <IconChevronDown size={13} />
              </button>

              {dropdownOpen && (
                <div className="zcode-subagent-dropdown-menu">
                  {allSubagents.map((s) => (
                    <button
                      key={s.id}
                      className={`zcode-subagent-dropdown-item ${s.id === subagent.id ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("light");
                        onSelectSubagent?.(s.id);
                        setDropdownOpen(false);
                      }}
                    >
                      <IconBot size={13} className="subagent-menu-bot-icon" />
                      <span className="subagent-menu-role">{s.role}</span>
                      {s.status === "failed" && <span className="subagent-failed-tag">失败</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active Subagent Tab */}
          <div className="zcode-subagent-tab-item is-active">
            <IconBot size={13} className="subagent-tab-icon" />
            <span className="subagent-tab-title" title={subagent.role}>
              {subagent.role}
            </span>
            {subagent.status === "failed" && (
              <span className="subagent-failed-tag" style={{ marginLeft: 4, color: "#f87171", fontSize: "10px" }}>
                执行失败
              </span>
            )}
            <button
              className="subagent-tab-close-btn"
              onClick={() => {
                triggerHaptic("light");
                onClose();
              }}
              title="关闭标签页返回主对话"
              aria-label="关闭标签"
            >
              <IconX size={12} />
            </button>
          </div>
        </div>

        <div className="zcode-subagent-tabs-right" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Desktop 1:1 More Options (⋮) Dropdown Menu */}
          <div className="main-header-menu-container" ref={menuRef} style={{ position: "relative" }}>
            <button
              className={`main-header-dots-btn ${menuOpen ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic("light");
                setMenuOpen((v) => !v);
              }}
              title="更多操作"
              aria-label="更多操作"
            >
              <IconMoreHorizontal size={15} />
            </button>

            {menuOpen && (
              <div className="zcode-header-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                {/* 1. Rename */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    triggerHaptic("light");
                    showToast("子智能体名称为自动分配");
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconPencil size={13} className="zcode-dropdown-icon" />
                    <span>重命名</span>
                  </div>
                </button>

                {/* 2. Pin */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    triggerHaptic("medium");
                    showToast("已置顶子智能体会话");
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconPin size={13} className="zcode-dropdown-icon" />
                    <span>置顶</span>
                  </div>
                </button>

                {/* 3. Archive */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    triggerHaptic("medium");
                    showToast("已归档子智能体会话");
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconArchive size={13} className="zcode-dropdown-icon" />
                    <span>归档</span>
                  </div>
                </button>

                <div className="zcode-dropdown-divider" />

                {/* 4. Copy Submenu (Desktop 1:1 match) */}
                <div
                  className="zcode-dropdown-item has-submenu"
                  onMouseEnter={() => setCopySubmenuOpen(true)}
                  onMouseLeave={() => setCopySubmenuOpen(false)}
                  onClick={() => setCopySubmenuOpen((v) => !v)}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconCopy size={13} className="zcode-dropdown-icon" />
                    <span>复制</span>
                  </div>
                  <IconChevron size={11} className="zcode-dropdown-arrow" />

                  {copySubmenuOpen && (
                    <div className="zcode-dropdown-submenu">
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(subagent.role, "对话名称");
                        }}
                      >
                        <span>复制对话名称</span>
                      </button>
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(subagent.conversationId || subagent.id, "对话 ID");
                        }}
                      >
                        <span>复制对话 ID</span>
                      </button>
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy("antigravity移动端", "项目名称");
                        }}
                      >
                        <span>复制项目名称</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            className="zcode-subagent-back-btn"
            onClick={() => {
              triggerHaptic("light");
              onClose();
            }}
            title="返回主对话"
          >
            <IconArrowLeft size={13} />
            <span>返回主对话</span>
          </button>
        </div>
      </div>

      {/* 2. Subagent Conversation Area — 100% same layout & logic as main ChatPanel */}
      <div
        className="chat-area zcode-subagent-chat-area"
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", padding: "16px 14px" }}
      >
        {/* Model info line */}
        <div className="zcode-subagent-model-row" style={{ marginBottom: "16px" }}>
          <div className="zcode-subagent-model-line" />
          <span className="zcode-subagent-model-text">
            正在使用 {subagent.model || "sensenova/sensenova-6.8-flash-lite"}
          </span>
          <div className="zcode-subagent-model-line" />
        </div>

        <div className="chat-area-inner" style={{ maxWidth: "100%", width: "100%" }}>
          {turns.map((turn, turnIdx) => {
            const hasSteps = turn.stepMessages.length > 0 || Boolean(turn.thinking) || (turnIdx === 0 && Boolean(subagent.duration));
            const isLastTurn = turnIdx === turns.length - 1;
            const summary = extractTurnSummary(turn.stepMessages, turn.assistantMessage);
            const hasSummary = summary.files.length > 0 || summary.artifacts.length > 0;

            return (
              <Fragment key={turn.id || `subturn-${turnIdx}`}>
                {/* 1. User Message (Task prompt) */}
                {turn.userMessage && (
                  <MessageBubble
                    msg={turn.userMessage}
                    isLocked={false}
                    isUnconfirmed={false}
                    suppressImplementationPlan={true}
                    onOpenFile={onOpenFile}
                  />
                )}

                {/* 2. Thinking & Work Steps (Explore, Read file, Command, Edit file) */}
                {hasSteps && (
                  <TurnStepsCollapsible
                    duration={turn.duration || subagent.duration}
                    thinkingDuration={turn.thinkingDuration}
                    isLive={subagent.status === "running" && isLastTurn}
                    thinking={turn.thinking}
                    steps={turn.stepMessages}
                    onOpenFile={onOpenFile}
                  />
                )}

                {/* 3. Assistant Full Markdown Response (Tables, headings, code, explanations) */}
                {turn.assistantMessage && (
                  <MessageBubble
                    msg={turn.assistantMessage}
                    isLocked={false}
                    isUnconfirmed={false}
                    suppressImplementationPlan={true}
                    onOpenFile={onOpenFile}
                  />
                )}

                {/* 4. Turn Completion Artifacts & Files Changed Summary Card */}
                {hasSummary && (
                  <TurnSummaryCard
                    summary={summary}
                    assistantContent={turn.assistantMessage?.content}
                    onOpenFile={onOpenFile}
                    onOpenReview={onOpenReview}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
