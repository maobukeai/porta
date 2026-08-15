import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { createPortal } from "react-dom";

import { useChatNotifications } from "../hooks/useChatNotifications";
import { useStepsStream } from "../hooks/useStepsStream";
import { setConversationWaiting, isAnyStepWaiting } from "../utils/waitingTasks";
import { stepsToMessages } from "../transforms/stepsToMessages";
import {
  isUnconfirmedOptimisticMessage,
  mergeOptimisticMessages,
} from "../utils/optimisticMessages";
import { renderMarkdown } from "../utils/markdown";
import { MarkdownContent } from "./MarkdownContent";
import { useMessageTouchGesture } from "../hooks/useMessageTouchGesture";
import { MessageActionSheet } from "./MessageActionSheet";
import { copyText } from "../utils/clipboard";
import { triggerHaptic } from "../utils/haptics";
import { Lightbox } from "./Lightbox";
import { api, getApiBase } from "../api/client";
import { RevertConfirmModal } from "./RevertConfirmModal";
import type { RevertFileChange } from "../utils/revertFiles";
import type { TrajectoryStep } from "../types";
import { useVisualViewport } from "../hooks/useVisualViewport";
import {
  AskQuestionCard,
  CommandCard,
  CodeActionCard,
  FilePermissionCard,
  SubagentCard,
} from "./StepCards";
import { QuotaAlertCard } from "./QuotaAlertCard";
import { parseQuotaError } from "../utils/quotaError";
import { ExplorationCard } from "./ExplorationCard";
import { getAskQuestionRequest, getFilePermissionRequest } from "../utils/stepCards";
import {
  IconCopy,
  IconCheck,
  IconUndo,
  IconEdit,
  IconSearch,
  IconFile,
  IconFileSearch,
  IconFolder,
  IconList,
  IconEye,
  IconMessageCircle,
  IconAlertTriangle,
  IconChevron,
  IconVolume,
  IconVolumeX,
  IconBrain,
  IconPlay,
  IconFileText,
  IconSparkles,
} from "./Icons";
import { speakTTS, stopTTS, isTTSSpeaking } from "../utils/speech";
import { ChatScrollSlider } from "./ChatScrollSlider";
import { TurnSummaryCard } from "./TurnSummaryCard";
import { extractTurnSummary } from "../utils/extractTurnSummary";
import { usePlanTracker } from "../hooks/usePlanTracker";
import { PlanProgressCard } from "./PlanProgressCard";
import { useSubagentViewer, type SubagentSession } from "../hooks/useSubagentViewer";
import type { AskQuestionEntry, ChatMessage } from "../types";

interface Props {
  cascadeId: string;
  activeSubagentId?: string | null;
  onSelectSubagent?: (id: string) => void;
  onCloseSubagent?: () => void;
  onRevert: (stepIndex: number, editText?: string, editMedia?: unknown[]) => void;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
  onConfirmOptimistic?: (ids: string[]) => void;
  optimisticMessages?: ChatMessage[];
  refreshKey?: number;
  hardRefreshKey?: number;
  totalStepCount?: number;
  isConversationRunning?: boolean;
  browserNotificationsEnabled?: boolean;
  conversationTitle?: string;
  onQuoteMessage?: (text: string) => void;
  /** Called when a code file item in exploration or message is clicked to open the right side panel */
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  /** Called when the Review button in turn summary card is clicked */
  onOpenReview?: () => void;
  /** Called when opening the subagents directory */
  onOpenSubagents?: () => void;
  /** Called when the WS reports the agent went idle — triggers sidebar refresh. */
  onSidebarRefresh?: () => void;
  /** Triggered when the user clicks interactive buttons (e.g. Proceed / Continue) in message cards */
  onSendMessage?: (text: string) => void;
}

function formatWorkDuration(duration?: string | number): string {
  if (duration === undefined || duration === null || duration === "") {
    return "已工作";
  }

  let totalSecs = 0;
  if (typeof duration === "number") {
    totalSecs = duration;
  } else {
    const str = String(duration).trim();
    if (!str) return "已工作";

    const msMatch = str.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
    if (msMatch) {
      totalSecs = parseFloat(msMatch[1]) / 1000;
    } else {
      const minMatch = str.match(/(\d+)\s*(?:m|min|分)/i);
      const secMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|秒)/i);
      if (minMatch) {
        const mins = parseInt(minMatch[1], 10);
        const secs = secMatch ? parseFloat(secMatch[1]) : 0;
        totalSecs = mins * 60 + secs;
      } else if (secMatch) {
        totalSecs = parseFloat(secMatch[1]);
      } else {
        const parsed = parseFloat(str);
        if (!isNaN(parsed)) {
          totalSecs = parsed;
        }
      }
    }
  }

  if (totalSecs <= 0) return "已工作";

  // If under 1 minute
  if (totalSecs < 60) {
    if (totalSecs < 10 && totalSecs % 1 !== 0) {
      return `已工作 ${totalSecs.toFixed(1)} 秒`;
    }
    const rounded = Math.max(1, Math.round(totalSecs));
    return `已工作 ${rounded} 秒`;
  }

  // If under 1 hour
  if (totalSecs < 3600) {
    const totalRounded = Math.round(totalSecs);
    const mins = Math.floor(totalRounded / 60);
    const remain = totalRounded % 60;
    return `已工作 ${mins} 分 ${remain > 0 ? `${remain} 秒` : ""}`.trim();
  }

  // If >= 1 hour
  const totalRounded = Math.round(totalSecs);
  const hours = Math.floor(totalRounded / 3600);
  const remainMins = Math.floor((totalRounded % 3600) / 60);
  return `已工作 ${hours} 小时 ${remainMins > 0 ? `${remainMins} 分` : ""}`.trim();
}

export function formatThinkingDuration(duration?: string | number): string {
  if (duration === undefined || duration === null || duration === "") return "思考过程 持续了几秒";
  if (typeof duration === "string") {
    const s = duration.trim();
    const cleanNum = parseFloat(s.replace(/[^0-9.]/g, ""));
    if (!isNaN(cleanNum) && cleanNum > 0) {
      if (cleanNum < 2) {
        return "思考过程 持续了几秒";
      }
      if (cleanNum < 60) {
        const rounded = cleanNum < 10 && cleanNum % 1 !== 0 ? cleanNum.toFixed(1) : Math.round(cleanNum);
        return `思考过程 持续了 ${rounded} 秒`;
      }
      const mins = Math.floor(cleanNum / 60);
      const secs = Math.round(cleanNum % 60);
      return `思考过程 持续了 ${mins} 分 ${secs > 0 ? `${secs} 秒` : ""}`.trim();
    }
    return `思考过程 持续了 ${s}`;
  }
  if (typeof duration === "number" && duration > 0) {
    if (duration < 2) {
      return "思考过程 持续了几秒";
    }
    if (duration < 60) {
      const rounded = duration < 10 && duration % 1 !== 0 ? duration.toFixed(1) : Math.max(1, Math.round(duration));
      return `思考过程 持续了 ${rounded} 秒`;
    }
    const mins = Math.floor(duration / 60);
    const secs = Math.round(duration % 60);
    return `思考过程 持续了 ${mins} 分 ${secs > 0 ? `${secs} 秒` : ""}`.trim();
  }
  return "思考过程 持续了几秒";
}

/** Collapsible implementation plan / thinking block */
function ImplementationPlanBlock({
  plan,
  duration,
  live = false,
}: {
  plan: string;
  duration?: string | number;
  live?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(live);
  const renderedPlan = useMemo(() => renderMarkdown(plan), [plan]);

  useEffect(() => {
    setOpen(live);
  }, [live]);

  return (
    <details
      className={`zcode-thinking-block${live ? " live" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="zcode-thinking-header">
        <IconBrain size={14} className="zcode-thinking-brain-icon" />
        <span className="zcode-thinking-label">
          {live ? "正在深度思考与执行…" : formatWorkDuration(duration)}
        </span>
        <span className="zcode-thinking-chevron">
          <IconChevron size={12} className={open ? "is-open" : ""} />
        </span>
      </summary>
      <div className="zcode-thinking-content">
        <MarkdownContent html={renderedPlan} />
        <div className="zcode-thinking-actions">
          <button
            className="msg-action-btn zcode-thinking-copy"
            title="复制思考过程"
            onClick={() => {
              void copyText(plan).then((success) => {
                if (success) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              });
            }}
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </button>
        </div>
      </div>
    </details>
  );
}



/** Map icon key → Lucide component */
function MsgIcon({ name }: { name?: string }) {
  if (!name) return null;
  const s = 12;
  switch (name) {
    case "search":
      return <IconSearch size={s} />;
    case "eye":
      return <IconEye size={s} />;
    case "file":
      return <IconFile size={s} />;
    case "file-search":
      return <IconFileSearch size={s} />;
    case "folder":
      return <IconFolder size={s} />;
    case "list":
      return <IconList size={s} />;
    case "alert":
      return <IconAlertTriangle size={s} />;
    default:
      return null;
  }
}

interface ChatTurn {
  id: string;
  userMessage?: ChatMessage;
  stepMessages: ChatMessage[];
  errorMessages: ChatMessage[];
  thinking?: string;
  thinkingDuration?: string | number;
  duration?: string | number;
  assistantMessage?: ChatMessage;
  isLive?: boolean;
}

export const TurnStepsCollapsible = memo(function TurnStepsCollapsible({
  duration,
  thinkingDuration,
  isLive = false,
  thinking,
  steps,
  onFilePermission,
  onCommandAction,
  onAskQuestion,
  onOpenFile,
  onSelectSubagent,
}: {
  duration?: string | number;
  thinkingDuration?: string | number;
  isLive?: boolean;
  thinking?: string;
  steps: ChatMessage[];
  onFilePermission?: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  onSelectSubagent?: (id: string) => void;
}) {
  const [workOpen, setWorkOpen] = useState(isLive);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setWorkOpen(isLive);
  }, [isLive]);

  const renderedThinking = useMemo(
    () => (thinking ? renderMarkdown(thinking) : ""),
    [thinking],
  );

  const workLabel = isLive
    ? "正在深度思考与执行…"
    : formatWorkDuration(duration);

  const thinkingLabel = formatThinkingDuration(thinkingDuration);

  return (
    <div className="message assistant pinned-implementation-plan-message">
      <div
        className={`chat-block message-body pinned-implementation-plan-body${
          isLive ? " live" : ""
        }`}
      >
        {/* 外层大折叠块 (工作时长：汇总思考与所有修改步骤，默认收缩) */}
        <details
          className={`zcode-thinking-block zcode-work-block${isLive ? " live" : ""}`}
          open={workOpen}
          onToggle={(e) => setWorkOpen(e.currentTarget.open)}
        >
          <summary className="zcode-thinking-header zcode-work-header">
            <div className="zcode-work-header-left">
              <IconBrain size={14} className="zcode-thinking-brain-icon" />
              <span className="zcode-thinking-label">{workLabel}</span>
              {steps.length > 0 && (
                <span className="zcode-work-step-pill">
                  {steps.length} 个步骤
                </span>
              )}
              {isLive && (
                <span className="zcode-work-live-dot" title="正在实时执行" />
              )}
            </div>
            <span className="zcode-thinking-chevron">
              <IconChevron size={12} className={workOpen ? "is-open" : ""} />
            </span>
          </summary>

          <div className="zcode-work-content">
            {/* 1. 内层思考过程折叠块 (思考时长：仅折叠/展开思维链，默认也是收缩的) */}
            {thinking && (
              <details
                className="zcode-thinking-inner-block"
                open={thinkingOpen}
                onToggle={(e) => setThinkingOpen(e.currentTarget.open)}
              >
                <summary className="zcode-thinking-inner-header">
                  <IconBrain size={14} className="zcode-thinking-brain-icon" />
                  <span className="zcode-thinking-label">{thinkingLabel}</span>
                  <span className="zcode-thinking-chevron">
                    <IconChevron size={11} className={thinkingOpen ? "is-open" : ""} />
                  </span>
                </summary>

                <div className="zcode-thinking-content">
                  <div className="zcode-thinking-inner-text">
                    <MarkdownContent html={renderedThinking} />
                    <div className="zcode-thinking-actions">
                      <button
                        className="msg-action-btn zcode-thinking-copy"
                        title="复制思考过程"
                        onClick={() => {
                          if (!thinking) return;
                          void copyText(thinking).then((success) => {
                            if (success) {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            }
                          });
                        }}
                      >
                        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </details>
            )}

            {/* 2. 下方的工具与文件修改步骤列表 (探索、读取、编辑、运行指令等) */}
            {steps.length > 0 && (
              <div className="turn-steps-list">
                {steps.map((stepMsg, idx) => (
                  <SystemMessage
                    key={stepMsg.optimisticId ?? `${stepMsg.stepIndex}-${idx}`}
                    msg={stepMsg}
                    onFilePermission={onFilePermission || (() => {})}
                    onCommandAction={onCommandAction}
                    onAskQuestion={onAskQuestion}
                    onOpenFile={onOpenFile}
                    onSelectSubagent={onSelectSubagent}
                  />
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
});

export function isErrorMessage(msg: ChatMessage): boolean {
  if (msg.role === "user") return false;

  // 1. Explicit error types generated by server/proxy or error step handlers
  if (msg.type === "error" || msg.icon === "alert" || (msg.role as any) === "error") {
    return true;
  }

  // 2. Normal assistant messages should NEVER be classified as errors
  // unless they are explicitly raw RPC/HTTP network exceptions (like raw JSON {"error": ...} or raw Error: Post ...)
  if (msg.role === "assistant") {
    const content = (msg.content || "").trim();
    if (
      /^Error:\s*(?:request failed|Post\s*\"https?:\/\/|wsasend|forcibly closed|status code:\s*429|RESOURCE_EXHAUSTED)/i.test(content) ||
      (/^\{[\s\S]*\"(?:error|error_message|errorMessage)\"[\s\S]*\}$/.test(content) && content.length < 500)
    ) {
      return true;
    }
    return false;
  }

  // 3. System messages that are raw error strings
  const content = (msg.content || "").trim();
  if (
    /^(?:Error:|Request failed|Status code:?\s*(?:429|500|502|503)|baseline model quota reached|resource_exhausted|wsasend|forcibly closed|streamgeneratecontent)/i.test(
      content,
    )
  ) {
    return true;
  }

  return false;
}

export function deduplicateErrorMessages(errors: ChatMessage[]): ChatMessage[] {
  if (errors.length <= 1) return errors;

  const parsed = errors.map((e) => ({
    msg: e,
    info: parseQuotaError(e.content),
  }));

  // 1. Prioritize baseline quota error with refresh time, then any baseline quota error
  const baselineWithTime = parsed.find(
    (p) => p.info.errorType === "baseline_quota" && p.info.refreshTime,
  );
  if (baselineWithTime) return [baselineWithTime.msg];

  const baseline = parsed.find((p) => p.info.errorType === "baseline_quota");
  if (baseline) return [baseline.msg];

  // 2. Prioritize rate limit error
  const rateLimit = parsed.find((p) => p.info.errorType === "rate_limit");
  if (rateLimit) return [rateLimit.msg];

  // 3. Prioritize stream disconnect error
  const streamDisconnect = parsed.find(
    (p) => p.info.errorType === "stream_disconnect",
  );
  if (streamDisconnect) return [streamDisconnect.msg];

  // 4. Fallback: Deduplicate by unique cleaned detail/summary and keep at most 1 primary alert
  const seen = new Set<string>();
  const unique: ChatMessage[] = [];
  for (const p of parsed) {
    const key = p.info.detail || p.msg.content;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p.msg);
    }
  }
  return unique.slice(0, 1);
}

export function groupMessagesIntoTurns(
  messages: ChatMessage[],
  isWsRunning: boolean,
): ChatTurn[] {
  if (messages.length === 0) return [];

  const turns: ChatTurn[] = [];
  let currentTurn: ChatTurn = {
    id: "turn-0",
    stepMessages: [],
    errorMessages: [],
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "user") {
      if (
        currentTurn.userMessage ||
        currentTurn.stepMessages.length > 0 ||
        currentTurn.errorMessages.length > 0 ||
        currentTurn.assistantMessage ||
        currentTurn.thinking
      ) {
        currentTurn.errorMessages = deduplicateErrorMessages(
          currentTurn.errorMessages,
        );
        turns.push(currentTurn);
      }
      currentTurn = {
        id: `turn-${i}`,
        userMessage: msg,
        stepMessages: [],
        errorMessages: [],
      };
      continue;
    }

    if (isErrorMessage(msg)) {
      currentTurn.errorMessages.push(msg);
      continue;
    }

    if (msg.thinking) {
      if (!currentTurn.thinking) {
        currentTurn.thinking = msg.thinking;
      } else {
        currentTurn.thinking += `\n\n${msg.thinking}`;
      }
    }
    if (msg.thinkingDuration) {
      currentTurn.thinkingDuration = msg.thinkingDuration;
      if (!currentTurn.duration) {
        currentTurn.duration = msg.thinkingDuration;
      }
    }

    currentTurn.stepMessages.push(msg);
  }

  if (
    currentTurn.userMessage ||
    currentTurn.stepMessages.length > 0 ||
    currentTurn.errorMessages.length > 0 ||
    currentTurn.assistantMessage ||
    currentTurn.thinking
  ) {
    currentTurn.errorMessages = deduplicateErrorMessages(
      currentTurn.errorMessages,
    );
    turns.push(currentTurn);
  }

  for (let t = 0; t < turns.length; t++) {
    const turn = turns[t];
    const isLastTurn = t === turns.length - 1;

    if (isLastTurn && isWsRunning) {
      turn.isLive = true;
    }

    // Promote the last assistant response with text to turn.assistantMessage (final report)
    if (turn.stepMessages.length > 0) {
      let lastAssistantIdx = -1;
      for (let m = turn.stepMessages.length - 1; m >= 0; m--) {
        const sm = turn.stepMessages[m];
        if (sm.role === "assistant" && sm.content && sm.content.trim()) {
          lastAssistantIdx = m;
          break;
        }
      }

      if (lastAssistantIdx !== -1) {
        // If not live, or if the assistant message is at the end of the steps, it is the final response
        const isAtEnd = lastAssistantIdx === turn.stepMessages.length - 1;
        if (!turn.isLive || isAtEnd) {
          turn.assistantMessage = turn.stepMessages[lastAssistantIdx];
          turn.stepMessages.splice(lastAssistantIdx, 1);
        }
      }
    }

    // Calculate actual elapsed duration across all steps and messages in the turn
    const timestamps: number[] = [];
    const collectTime = (step?: TrajectoryStep) => {
      if (!step?.metadata) return;
      if (step.metadata.createdAt) {
        const time = new Date(step.metadata.createdAt).getTime();
        if (!isNaN(time) && time > 0) timestamps.push(time);
      }
      if (step.metadata.completedAt) {
        const time = new Date(step.metadata.completedAt).getTime();
        if (!isNaN(time) && time > 0) timestamps.push(time);
      }
    };

    if (turn.userMessage?.step) collectTime(turn.userMessage.step);
    for (const sm of turn.stepMessages) {
      if (sm.step) collectTime(sm.step);
    }
    for (const em of turn.errorMessages) {
      if (em.step) collectTime(em.step);
    }
    if (turn.assistantMessage?.step) collectTime(turn.assistantMessage.step);

    if (timestamps.length >= 2) {
      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);
      if (maxTime > minTime) {
        const elapsedSecs = (maxTime - minTime) / 1000;
        if (elapsedSecs >= 0.1) {
          turn.duration = elapsedSecs;
        }
      }
    }
  }

  return turns;
}

const SystemMessage = memo(function SystemMessage({
  msg,
  onFilePermission,
  onCommandAction,
  onAskQuestion,
  onOpenFile,
  onSelectSubagent,
}: {
  msg: ChatMessage;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  onSelectSubagent?: (id: string) => void;
}) {
  const renderedContent = useMemo(
    () => renderMarkdown(msg.content ?? ""),
    [msg.content],
  );

  if (msg.step) {
    // File permission request — render dedicated card
    if (msg.type === "CORTEX_STEP_TYPE_FILE_PERMISSION") {
      const fpr = getFilePermissionRequest(msg.step);
      if (fpr) {
        return (
          <div className="message system">
            <FilePermissionCard
              step={msg.step}
              permissionRequest={fpr}
              onFilePermission={onFilePermission}
              onGenericPermission={onCommandAction}
            />
          </div>
        );
      }
    }
    if (msg.type === "CORTEX_STEP_TYPE_ASK_QUESTION") {
      const askQuestion = getAskQuestionRequest(msg.step);
      if (askQuestion) {
        return (
          <div className="message system">
            <AskQuestionCard
              step={msg.step}
              askQuestionRequest={askQuestion}
              fallbackStepIndex={msg.stepIndex}
              onAskQuestion={onAskQuestion}
            />
          </div>
        );
      }
    }
    if (msg.type === "CORTEX_STEP_TYPE_RUN_COMMAND") {
      return (
        <div className="message system">
          <CommandCard step={msg.step} onCommandAction={onCommandAction} />
        </div>
      );
    }
    if (msg.type === "CORTEX_STEP_TYPE_CODE_ACTION") {
      return (
        <div className="message system">
          <CodeActionCard step={msg.step} onOpenFile={onOpenFile} />
        </div>
      );
    }
    if (msg.type === "CORTEX_STEP_TYPE_SUBAGENT") {
      return (
        <div className="message system">
          <SubagentCard step={msg.step} data={msg.subagent} onSelectSubagent={onSelectSubagent} />
        </div>
      );
    }
  }

  const isErrorOrQuota =
    msg.type === "error" ||
    msg.icon === "alert" ||
    /baseline model quota reached|quota reached|quota will refresh|exceeded quota|rate limit|resource_exhausted|wsasend|forcibly closed|streamgeneratecontent/i.test(
      msg.content,
    );

  if (isErrorOrQuota) {
    return (
      <div className="message system">
        <QuotaAlertCard content={msg.content} />
      </div>
    );
  }

  if (msg.explorationGroup && msg.explorationGroup.items.length > 0) {
    return (
      <div className="message system">
        <ExplorationCard exploration={msg.explorationGroup} onOpenFile={onOpenFile} />
      </div>
    );
  }

  if (!renderedContent.trim() && !msg.icon) {
    return null;
  }

  return (
    <div className="message system">
      <div className="chat-block step-card info-card">
        <div className="step-card-header">
          {msg.icon && (
            <span className="step-card-icon">
              <MsgIcon name={msg.icon} />
            </span>
          )}
          <span
            className="info-card-text"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
      </div>
    </div>
  );
});

export function resolveMediaSrc(m: unknown): string | null {
  if (!m) return null;
  const base = getApiBase();
  const toProxyUrl = (pathOrUri: string) => `${base}/api/files?uri=${encodeURIComponent(pathOrUri)}`;

  // 1. String media
  if (typeof m === "string") {
    const trimmed = m.trim();
    if (!trimmed) return null;
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }
    if (
      trimmed.startsWith("file://") ||
      trimmed.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(trimmed)
    ) {
      return toProxyUrl(trimmed);
    }
    return `data:image/png;base64,${trimmed}`;
  }

  // 2. Object media
  if (typeof m !== "object") return null;
  const item = m as Record<string, any>;
  const mimeType =
    item.mimeType ||
    item.mime_type ||
    item.type ||
    item.contentType ||
    "image/png";

  // Check file URIs or paths first
  const fileRef =
    item.uri ||
    item.fileUri ||
    item.file_uri ||
    item.url ||
    item.src ||
    item.path ||
    item.filePath ||
    item.file_path;

  if (typeof fileRef === "string" && fileRef.trim()) {
    const trimmed = fileRef.trim();
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }
    return toProxyUrl(trimmed);
  }

  // Check payload from Connect RPC / Protobuf
  if (item.payload) {
    if (typeof item.payload === "string") {
      const trimmed = item.payload.trim();
      if (
        trimmed.startsWith("file://") ||
        trimmed.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(trimmed)
      ) {
        return toProxyUrl(trimmed);
      }
      if (
        trimmed.startsWith("data:") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
      ) {
        return trimmed;
      }
      return `data:${mimeType};base64,${trimmed}`;
    }

    if (typeof item.payload === "object") {
      const pCase = item.payload.case;
      let pVal =
        item.payload.value ?? item.payload.inlineData ?? item.payload.data;
      let effMime = mimeType;
      if (typeof pVal === "object" && pVal !== null) {
        if (pVal.mimeType || pVal.mime_type) effMime = pVal.mimeType || pVal.mime_type;
        pVal = pVal.data || pVal.inlineData || pVal.value || pVal.bytes || pVal.fileUri || pVal.uri;
      }
      if (typeof pVal === "string" && pVal.trim()) {
        const trimmed = pVal.trim();
        if (
          pCase === "fileUri" ||
          pCase === "uri" ||
          pCase === "path" ||
          trimmed.startsWith("file://") ||
          trimmed.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(trimmed)
        ) {
          return toProxyUrl(trimmed);
        }
        if (
          trimmed.startsWith("data:") ||
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://") ||
          trimmed.startsWith("blob:")
        ) {
          return trimmed;
        }
        return `data:${effMime};base64,${trimmed}`;
      }
    }
  }

  // Check inlineData / inline_data / data / bytes / base64
  let rawData =
    item.inlineData ??
    item.inline_data ??
    item.data ??
    item.bytes ??
    item.base64;

  if (typeof rawData === "object" && rawData !== null) {
    rawData =
      rawData.data || rawData.inlineData || rawData.value || rawData.bytes;
  }

  if (typeof rawData === "string" && rawData.trim()) {
    const trimmed = rawData.trim();
    if (
      trimmed.startsWith("file://") ||
      trimmed.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(trimmed)
    ) {
      return `/api/files?uri=${encodeURIComponent(trimmed)}`;
    }
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://")
    ) {
      return trimmed;
    }
    return `data:${mimeType};base64,${trimmed}`;
  }

  return null;
}

/** Render media thumbnails from a user message */
function MediaThumbs({
  media,
  onImageClick,
}: {
  media: unknown[];
  onImageClick?: (src: string) => void;
}) {
  if (!media || media.length === 0) return null;

  return (
    <div className="message-media">
      {media.map((m, i) => {
        const src = resolveMediaSrc(m);
        if (!src) return null;

        return (
          <img
            key={i}
            src={src}
            alt="attachment"
            className="message-media-thumb"
            onClick={() => onImageClick?.(src)}
            title="点击查看大图"
          />
        );
      })}
    </div>
  );
}

/** Copy message text button */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action-btn"
      title="复制"
      onClick={() => {
        void copyText(text).then((success) => {
          if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  );
}

/** Detects if an assistant message prompts user to Proceed / continue / confirm plan */
export function detectProceedPrompt(
  content?: string,
  role?: string,
): {
  isProceed: boolean;
  planFile?: string;
  label?: string;
  promptText?: string;
} {
  if (!content || role !== "assistant") return { isProceed: false };

  // 1. Detect keywords asking user to Proceed or continue
  const hasProceedKeyword =
    /点击\s*Proceed|回复\s*继续|点击\s*继续|Proceed\s*或回复继续|确认无误后点击|确认无误后\s*Proceed|输入\s*“?Proceed”?|点击\s*“?Proceed”?|Proceed\s*to\s*continue|Click\s*Proceed|点\s*Proceed|点击下方.*继续/i.test(
      content,
    ) ||
    /点击\s*\[?Proceed\]?|输入\s*\[?Proceed\]?|“?Proceed”?\s*按钮/i.test(content);

  // 2. Extract potential plan filename (e.g. implementation_plan.md)
  const planMatch = content.match(/([a-zA-Z0-9_\-\/]+\.(?:md|markdown|plan))/i);
  const planFile = planMatch ? planMatch[1] : undefined;

  if (hasProceedKeyword) {
    let label = "Proceed (继续执行)";
    let promptText = "请审阅方案，确认无误后点击下方按钮继续";
    if (/Proceed/i.test(content)) {
      label = "Proceed (继续)";
    }
    return {
      isProceed: true,
      planFile,
      label,
      promptText,
    };
  }

  // 3. Detect plan artifact confirmation patterns
  if (
    content.includes("RequestFeedback") ||
    (content.includes("implementation_plan.md") &&
      /请审阅|请确认|开始编码|开始实现/i.test(content))
  ) {
    return {
      isProceed: true,
      planFile: planFile || "implementation_plan.md",
      label: "Proceed (开始编码)",
      promptText: "方案已制定完成，点击继续开始编码",
    };
  }

  return { isProceed: false, planFile };
}

/** Memoized message bubble — prevents WS-driven re-renders from destroying caret/selection */
interface MessageBubbleProps {
  msg: ChatMessage;
  isLocked: boolean;
  isUnconfirmed: boolean;
  suppressImplementationPlan?: boolean;
  onRevert?: (stepIndex: number, editText?: string, editMedia?: unknown[]) => void;
  onOpenRevertConfirm?: (stepIndex: number, draftContent?: string, draftMedia?: unknown[]) => void;
  onImageClick?: (src: string) => void;
  onQuote?: (text: string) => void;
  onSendMessage?: (text: string) => void;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  isConversationRunning?: boolean;
  isLatestAssistantMessage?: boolean;
  hasProceeded?: boolean;
  onProceed?: (stepIndex: number) => void;
  subagentSessions?: SubagentSession[];
  onSelectSubagent?: (id: string) => void;
}

export const MessageBubble = memo(
  function MessageBubble({
    msg,
    isLocked,
    isUnconfirmed,
    suppressImplementationPlan = false,
    onRevert,
    onOpenRevertConfirm,
    onImageClick,
    onQuote,
    onSendMessage,
    onOpenFile,
    isConversationRunning = false,
    isLatestAssistantMessage = false,
    hasProceeded = false,
    onProceed,
    subagentSessions: _subagentSessions = [],
    onSelectSubagent: _onSelectSubagent,
  }: MessageBubbleProps) {
    const [actionSheetOpen, setActionSheetOpen] = useState(false);
    const touchHandlers = useMessageTouchGesture({
      onLongPress: () => setActionSheetOpen(true),
    });

    const renderedContent = useMemo(
      () => (msg.content ? renderMarkdown(msg.content) : ""),
      [msg.content],
    );
    const showImplementationPlan =
      Boolean(msg.thinking) && !suppressImplementationPlan;

    const proceedInfo = useMemo(
      () => (msg.role === "assistant" ? detectProceedPrompt(msg.content, msg.role) : { isProceed: false }),
      [msg.content, msg.role],
    );

    const showProceedCard =
      msg.role === "assistant" &&
      isLatestAssistantMessage &&
      !isConversationRunning &&
      !hasProceeded &&
      proceedInfo.isProceed;

    if (
      !showImplementationPlan &&
      !msg.content &&
      (!msg.media || msg.media.length === 0)
    ) {
      return null;
    }

    return (
      <div
        className={`message ${msg.role}${isUnconfirmed ? " unconfirmed" : ""}`}
        {...touchHandlers}
      >
        <div className="chat-block message-body">
          {showImplementationPlan && msg.thinking && (
            <ImplementationPlanBlock
              plan={msg.thinking}
              duration={msg.thinkingDuration}
            />
          )}
          {msg.media && msg.media.length > 0 && (
            <MediaThumbs media={msg.media} onImageClick={onImageClick} />
          )}
          {/* Normal Assistant Markdown content */}
          {msg.content && <MarkdownContent html={renderedContent} />}

          {/* Interactive Proceed Callout Card — Only shown when this is the latest assistant message, not yet clicked, and agent is idle */}
          {showProceedCard && (
            <div className="msg-proceed-card">
              <div className="msg-proceed-header">
                <div className="msg-proceed-title-wrap">
                  <IconSparkles size={14} className="msg-proceed-sparkle" />
                  <span className="msg-proceed-title">
                    {proceedInfo.promptText || "方案已确认就绪，点击下方按钮继续"}
                  </span>
                </div>
              </div>
              <div className="msg-proceed-actions">
                <button
                  type="button"
                  className="msg-proceed-btn primary"
                  onClick={() => {
                    triggerHaptic("medium");
                    if (onProceed) {
                      onProceed(msg.stepIndex);
                    }
                    if (onSendMessage) {
                      onSendMessage("Proceed");
                    }
                  }}
                  disabled={isConversationRunning}
                  title="点击发送 Proceed，继续执行后续任务"
                >
                  <IconPlay size={13} />
                  <span>{proceedInfo.label || "Proceed (继续)"}</span>
                </button>

                {proceedInfo.planFile && onOpenFile && (
                  <button
                    type="button"
                    className="msg-proceed-btn secondary"
                    onClick={() => {
                      triggerHaptic("light");
                      onOpenFile({
                        name: proceedInfo.planFile!.split("/").pop() || proceedInfo.planFile!,
                        path: proceedInfo.planFile,
                        ext: "md",
                      });
                    }}
                    title={`在侧边面板中预览 ${proceedInfo.planFile}`}
                  >
                    <IconFileText size={13} />
                    <span>查看方案详情</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {msg.content && (
            <div className="msg-actions">
              {msg.role === "user" && (
                <button
                  className="msg-action-btn"
                  onClick={() => {
                    if (msg.content || (msg.media && msg.media.length > 0)) {
                      onRevert?.(-1, msg.content, msg.media);
                    }
                  }}
                  title="填入输入框（安全编辑，不修改代码）"
                >
                  <IconEdit size={13} />
                </button>
              )}
              {msg.role === "user" && msg.stepIndex >= 0 && (
                <button
                  className={`msg-action-btn ${isLocked ? "locked" : ""}`}
                  onClick={() => {
                    if (!isLocked) {
                      if (onOpenRevertConfirm) {
                        onOpenRevertConfirm(
                          msg.stepIndex,
                          msg.content,
                          msg.media,
                        );
                      } else {
                        onRevert?.(
                          msg.stepIndex,
                          msg.content,
                          msg.media,
                        );
                      }
                    }
                  }}
                  title="撤回并回滚代码快照"
                  disabled={isLocked}
                >
                  <IconUndo size={13} />
                </button>
              )}
              {msg.role === "assistant" && msg.content && (
                <button
                  className="msg-action-btn tts-btn"
                  onClick={() => {
                    if (isTTSSpeaking()) {
                      stopTTS();
                    } else {
                      speakTTS(msg.content);
                    }
                  }}
                  title="朗读回复（智能过滤代码与标记）"
                >
                  {isTTSSpeaking() ? (
                    <IconVolumeX size={13} className="active-icon" />
                  ) : (
                    <IconVolume size={13} />
                  )}
                </button>
              )}
              <CopyButton text={msg.content} />
            </div>
          )}
        </div>

        {actionSheetOpen && (
          <MessageActionSheet
            open={actionSheetOpen}
            onClose={() => setActionSheetOpen(false)}
            messageText={msg.content || ""}
            media={msg.media}
            isUserMessage={msg.role === "user"}
            stepIndex={msg.stepIndex}
            onQuote={onQuote}
            onRevert={onRevert}
            onOpenRevertConfirm={onOpenRevertConfirm}
          />
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.msg.content === next.msg.content &&
    prev.msg.thinking === next.msg.thinking &&
    prev.msg.thinkingDuration === next.msg.thinkingDuration &&
    prev.msg.stepIndex === next.msg.stepIndex &&
    prev.msg.role === next.msg.role &&
    prev.msg.media === next.msg.media &&
    prev.isLocked === next.isLocked &&
    prev.isUnconfirmed === next.isUnconfirmed &&
    prev.suppressImplementationPlan === next.suppressImplementationPlan &&
    prev.isConversationRunning === next.isConversationRunning &&
    prev.isLatestAssistantMessage === next.isLatestAssistantMessage &&
    prev.hasProceeded === next.hasProceeded &&
    prev.onProceed === next.onProceed &&
    prev.onSendMessage === next.onSendMessage &&
    prev.onOpenFile === next.onOpenFile &&
    prev.subagentSessions === next.subagentSessions &&
    prev.onSelectSubagent === next.onSelectSubagent,
);

const revertPreviewCache = new Map<string, RevertFileChange[]>();

export function ChatPanel({
  cascadeId,
  activeSubagentId: _activeSubagentIdProp,
  onSelectSubagent: onSelectSubagentProp,
  onCloseSubagent: _onCloseSubagentProp,
  onRevert,
  onFilePermission,
  onCommandAction,
  onAskQuestion,
  onConfirmOptimistic,
  optimisticMessages = [],
  refreshKey = 0,
  hardRefreshKey = 0,
  totalStepCount,
  isConversationRunning = false,
  browserNotificationsEnabled = false,
  conversationTitle,
  onQuoteMessage,
  onOpenFile,
  onOpenReview,
  onOpenSubagents,
  onSidebarRefresh,
  onSendMessage,
}: Props) {
  const [proceededStepIndexes, setProceededStepIndexes] = useState<Set<number>>(() => new Set());
  const handleProceed = useCallback((stepIndex: number) => {
    setProceededStepIndexes((prev) => new Set(prev).add(stepIndex));
  }, []);
  const {
    steps: rawSteps,
    baseOffset,
    loading,
    refresh,
    hardRefresh,
    hasMore,
    loadingOlder,
    loadOlder,
    wsRunning,
  } = useStepsStream(
    cascadeId,
    totalStepCount,
    onSidebarRefresh,
    isConversationRunning,
    browserNotificationsEnabled,
  );

  useChatNotifications({
    cascadeId,
    steps: rawSteps,
    loading,
    wsRunning,
    isConversationRunning,
    enabled: browserNotificationsEnabled,
    conversationTitle,
  });

  const [revertConfirmTarget, setRevertConfirmTarget] = useState<{
    stepIndex: number;
    draftContent?: string;
    draftMedia?: unknown[];
    files: RevertFileChange[];
  } | null>(null);

  const handleOpenRevertConfirm = useCallback(
    async (stepIndex: number, draftContent?: string, draftMedia?: unknown[]) => {
      if (!cascadeId || stepIndex < 0) {
        setRevertConfirmTarget({ stepIndex, draftContent, draftMedia, files: [] });
        return;
      }
      const targetStep = stepIndex;
      const key = `${cascadeId}:${targetStep}`;
      const cached = revertPreviewCache.get(key);
      if (cached) {
        setRevertConfirmTarget({ stepIndex, draftContent, draftMedia, files: cached });
        return;
      }

      try {
        const res = await api.getRevertPreview(cascadeId, targetStep);
        const files = res?.files ?? [];
        revertPreviewCache.set(key, files);
        setRevertConfirmTarget({ stepIndex, draftContent, draftMedia, files });
      } catch (e) {
        console.warn("Failed to fetch revert preview:", e);
        setRevertConfirmTarget({ stepIndex, draftContent, draftMedia, files: [] });
      }
    },
    [cascadeId],
  );

  // Soft re-fetch when refreshKey changes (e.g. after send)
  const prevKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== prevKeyRef.current) {
      prevKeyRef.current = refreshKey;
      refresh();
    }
  }, [refreshKey, refresh]);

  // Hard re-fetch when hardRefreshKey changes (e.g. after revert/stop)
  const prevHardKeyRef = useRef(hardRefreshKey);
  useEffect(() => {
    if (hardRefreshKey !== prevHardKeyRef.current) {
      prevHardKeyRef.current = hardRefreshKey;
      hardRefresh();
    }
  }, [hardRefreshKey, hardRefresh]);

  // Reset scroll state when switching chats
  const prevCascadeRef = useRef(cascadeId);
  const initialScrollTimestampRef = useRef(Date.now());
  const hasUserScrolledRef = useRef(false);

  useEffect(() => {
    if (cascadeId !== prevCascadeRef.current) {
      prevCascadeRef.current = cascadeId;
      didInitialScroll.current = false;
      hasUserScrolledRef.current = false;
      initialScrollTimestampRef.current = Date.now();
    }
  }, [cascadeId]);

  const serverMessages = useMemo(() => stepsToMessages(rawSteps, baseOffset), [rawSteps, baseOffset]);
  const {
    messages,
    confirmedOptimisticIds,
    hasUnconfirmedOptimistic,
  } = useMemo(
    () => mergeOptimisticMessages(serverMessages, optimisticMessages),
    [serverMessages, optimisticMessages],
  );

  const turns = useMemo(
    () => groupMessagesIntoTurns(messages, wsRunning),
    [messages, wsRunning],
  );

  const planData = usePlanTracker(cascadeId, rawSteps, messages);

  const {
    subagents: subagentSessions,
    openSubagent: hookOpenSubagent,
  } = useSubagentViewer(rawSteps);

  const openSubagent = onSelectSubagentProp || hookOpenSubagent;

  useEffect(() => {
    if (confirmedOptimisticIds.length === 0 || !onConfirmOptimistic) return;
    onConfirmOptimistic(confirmedOptimisticIds);
  }, [confirmedOptimisticIds, onConfirmOptimistic]);

  const lastMsg = messages[messages.length - 1];
  const lastIsAssistantWithContent =
    lastMsg?.role === "assistant" && Boolean(lastMsg.content.trim());
  const isLocked = wsRunning && !lastIsAssistantWithContent;
  const showTyping = (wsRunning || hasUnconfirmedOptimistic) && !lastIsAssistantWithContent;

  // Preload revert previews in the background so opening modal is 100% instant (0ms)
  useEffect(() => {
    if (!cascadeId || rawSteps.length === 0) return;
    const targetSteps = messages
      .filter((m) => m.role === "user" && m.stepIndex >= 0)
      .slice(-10)
      .map((m) => m.stepIndex);

    for (const targetStep of targetSteps) {
      const key = `${cascadeId}:${targetStep}`;
      if (!revertPreviewCache.has(key)) {
        api
          .getRevertPreview(cascadeId, targetStep)
          .then((res: { files?: RevertFileChange[] }) => {
            if (res?.files) {
              revertPreviewCache.set(key, res.files);
            }
          })
          .catch(() => {});
      }
    }
  }, [cascadeId, messages, rawSteps]);

  // Real-time synchronization of waiting interaction status for sidebar/overview indicator
  useEffect(() => {
    if (!cascadeId) return;
    setConversationWaiting(cascadeId, isAnyStepWaiting(rawSteps));
  }, [cascadeId, rawSteps]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const isNearBottom = useRef(true);
  const showScrollBtnRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const prevMsgCount = useRef(messages.length);
  const suppressScroll = useRef(false);
  const prevBaseOffsetRef = useRef(baseOffset);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const isLoadingOlderRef = useRef(false);

  // Auto-scroll on initial mount, follow new bottom messages, and restore position on prepend
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!didInitialScroll.current && messages.length > 0) {
      didInitialScroll.current = true;
      initialScrollTimestampRef.current = Date.now();
      el.scrollTop = el.scrollHeight;
      prevBaseOffsetRef.current = baseOffset;
      prevMsgCount.current = messages.length;
      return;
    }

    // CASE 1: Older messages prepended at the top (baseOffset decreased)
    if (baseOffset < prevBaseOffsetRef.current) {
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDiff > 0) {
        el.scrollTop = prevScrollTopRef.current + heightDiff;
      }
      prevBaseOffsetRef.current = baseOffset;
      prevMsgCount.current = messages.length;
      return;
    }

    prevBaseOffsetRef.current = baseOffset;

    // CASE 2: New messages arrived at the bottom (follow if near bottom)
    if (messages.length > prevMsgCount.current && isNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMsgCount.current = messages.length;
  }, [messages.length, baseOffset]);

  const triggerLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || isLoadingOlderRef.current || !didInitialScroll.current) return;

    isLoadingOlderRef.current = true;
    prevScrollHeightRef.current = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;

    loadOlder().finally(() => {
      // Cooldown to ensure scroll position settles before allowing next batch on scroll up
      setTimeout(() => {
        isLoadingOlderRef.current = false;
      }, 500);
    });
  }, [hasMore, loadOlder]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || suppressScroll.current) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    // Only trigger re-render when the button visibility actually changes
    const shouldShow = distFromBottom > 200;
    if (shouldShow !== showScrollBtnRef.current) {
      showScrollBtnRef.current = shouldShow;
      setShowScrollBtn(shouldShow);
    }
    isNearBottom.current = distFromBottom < 100;

    // If user has scrolled significantly away from top, mark user interaction
    if (el.scrollTop > 80) {
      hasUserScrolledRef.current = true;
    }

    // Track scroll snapshot continuously
    prevScrollHeightRef.current = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;

    // Auto-load older messages ONLY when:
    // 1. Initial scroll has completed
    // 2. More than 1200ms has elapsed since opening this chat (prevents loading on switch)
    // 3. The container is actually long enough to scroll (scrollHeight > clientHeight + 150)
    // 4. User has actually scrolled down and then reached the extreme top (scrollTop <= 5)
    // 5. Not currently loading
    const timeSinceInit = Date.now() - initialScrollTimestampRef.current;
    const isScrollable = el.scrollHeight > el.clientHeight + 150;

    if (
      didInitialScroll.current &&
      timeSinceInit > 1200 &&
      isScrollable &&
      hasUserScrolledRef.current &&
      el.scrollTop <= 5 &&
      hasMore &&
      !isLoadingOlderRef.current
    ) {
      triggerLoadOlder();
    }
  }, [hasMore, triggerLoadOlder]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const vvState = useVisualViewport();
  useEffect(() => {
    if (vvState.isKeyboardVisible && isNearBottom.current) {
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [vvState.isKeyboardVisible, scrollToBottom]);

  const innerRef = useRef<HTMLDivElement>(null);

  // Single capture-phase error listener attached once to handle any broken images in chat
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const handleError = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLImageElement && target.closest(".message-body")) {
        target.dataset.failed = "1";
        target.alt = "⚠ 图片加载失败 (点击可尝试查看)";
      }
    };
    el.addEventListener("error", handleError, true);
    return () => el.removeEventListener("error", handleError, true);
  }, []);

  // Open lightbox when clicking markdown-rendered <img> in message bodies.
  // Uses React onClick (synthetic event delegation) so it survives dangerouslySetInnerHTML DOM replacement.
  const handleImgClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "IMG" &&
      target.closest(".message-body")
    ) {
      e.preventDefault();
      setLightboxSrc((target as HTMLImageElement).src);
    }
  }, []);

  const handleChatAreaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleImgClick(e);
      const el = document.activeElement;
      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement
      ) {
        el.blur();
      }
    },
    [handleImgClick],
  );

  if (loading && messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <div className="chat-empty-icon">
            <IconMessageCircle size={48} />
          </div>
          <div className="chat-empty-text">暂无消息</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area-container">
      {/* ── Top-Right Plan & Progress Tracker (1:1 Antigravity Desktop Floating Panel) ── */}
      <PlanProgressCard
        planData={planData}
        subagentSessions={subagentSessions}
        onSelectSubagent={openSubagent}
        onOpenPlanDetail={() => {
          if (onOpenFile) {
            onOpenFile({
              name: "implementation_plan.md",
              path: "implementation_plan.md",
              ext: "md",
            });
          } else if (onOpenReview) {
            onOpenReview();
          }
        }}
        onOpenSubagents={onOpenSubagents || onOpenReview}
      />

      <div
        className="chat-area"
        ref={scrollRef}
        onScroll={handleScroll}
        onTouchMove={() => {
          // Dismiss iOS keyboard when scrolling chat area
          const el = document.activeElement;
          if (
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLInputElement
          ) {
            el.blur();
          }
        }}
      >
        <div className="chat-area-inner" ref={innerRef} onClick={handleChatAreaClick}>
          {hasMore && (
            <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
              <button
                type="button"
                className="zcode-load-older-banner-btn"
                onClick={triggerLoadOlder}
                disabled={loadingOlder}
                style={{
                  background: "rgba(255, 255, 255, 0.07)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "#a1a1aa",
                  borderRadius: "18px",
                  padding: "5px 14px",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
              >
                {loadingOlder ? (
                  <>
                    <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                    <span>正在加载历史消息...</span>
                  </>
                ) : (
                  <span>↑ 查看更早的历史对话 (还有 {baseOffset} 条)</span>
                )}
              </button>
            </div>
          )}

          {loadingOlder && !hasMore && (
            <div className="loading-older">
              <div className="loading-spinner" />
            </div>
          )}

          {turns.map((turn, turnIdx) => {
            const hasSteps =
              turn.stepMessages.length > 0 || Boolean(turn.thinking);
            const hasErrors =
              turn.errorMessages && turn.errorMessages.length > 0;
            return (
              <Fragment key={turn.id || `turn-${turnIdx}`}>
                {turn.userMessage && (
                  <MessageBubble
                    msg={turn.userMessage}
                    isLocked={isLocked}
                    isUnconfirmed={isUnconfirmedOptimisticMessage(
                      turn.userMessage,
                    )}
                    suppressImplementationPlan={true}
                    onRevert={onRevert}
                    onOpenRevertConfirm={handleOpenRevertConfirm}
                    onImageClick={setLightboxSrc}
                    onQuote={onQuoteMessage}
                  />
                )}

                {hasSteps && (
                  <TurnStepsCollapsible
                    duration={turn.duration}
                    thinkingDuration={turn.thinkingDuration}
                    isLive={turn.isLive}
                    thinking={turn.thinking}
                    steps={turn.stepMessages}
                    onFilePermission={onFilePermission}
                    onCommandAction={onCommandAction}
                    onAskQuestion={onAskQuestion}
                    onOpenFile={onOpenFile}
                    onSelectSubagent={openSubagent}
                  />
                )}

                {hasErrors && (
                  <div className="turn-error-container">
                    {turn.errorMessages.map((errMsg, errIdx) => (
                      <QuotaAlertCard
                        key={errMsg.optimisticId ?? `${errMsg.stepIndex}-${errIdx}`}
                        content={errMsg.content}
                        isHistorical={turnIdx < turns.length - 1}
                      />
                    ))}
                  </div>
                )}

                {turn.assistantMessage && (() => {
                  const isLastTurn = turnIdx === turns.length - 1;
                  const isLatestAssistantMessage = isLastTurn && !turn.isLive && !isConversationRunning;
                  const hasProceeded = proceededStepIndexes.has(turn.assistantMessage.stepIndex);
                  return (
                    <MessageBubble
                      msg={turn.assistantMessage}
                      isLocked={isLocked}
                      isUnconfirmed={isUnconfirmedOptimisticMessage(
                        turn.assistantMessage,
                      )}
                      suppressImplementationPlan={true}
                      onRevert={onRevert}
                      onOpenRevertConfirm={handleOpenRevertConfirm}
                      onImageClick={setLightboxSrc}
                      onQuote={onQuoteMessage}
                      onSendMessage={onSendMessage}
                      onOpenFile={onOpenFile}
                      isConversationRunning={isConversationRunning}
                      isLatestAssistantMessage={isLatestAssistantMessage}
                      hasProceeded={hasProceeded}
                      onProceed={handleProceed}
                      subagentSessions={subagentSessions}
                      onSelectSubagent={openSubagent}
                    />
                  );
                })()}

                {/* Turn Completion Artifacts & Files Changed Summary Card (Desktop 1:1) */}
                {(() => {
                  const isLastTurn = turnIdx === turns.length - 1;
                  // Only display after the turn has finished (not live / running)
                  if (turn.isLive || (isLastTurn && isConversationRunning)) {
                    return null;
                  }
                  const summary = extractTurnSummary(turn.stepMessages, turn.assistantMessage);
                  if (summary.files.length === 0 && summary.artifacts.length === 0) {
                    return null;
                  }
                  return (
                    <TurnSummaryCard
                      summary={summary}
                      assistantContent={turn.assistantMessage?.content}
                      onOpenFile={onOpenFile}
                      onOpenReview={onOpenReview}
                    />
                  );
                })()}
              </Fragment>
            );
          })}
          {showTyping && (
            <div className="message assistant">
              <div className="message-body">
                <div className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>
        {showScrollBtn && (
          <button
            className="scroll-to-bottom-btn"
            onClick={scrollToBottom}
            aria-label="滚动到底部"
          >
            ↓
          </button>
        )}
        {lightboxSrc &&
          createPortal(
            <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />,
            document.body,
          )}
        <RevertConfirmModal
          isOpen={revertConfirmTarget !== null}
          onClose={() => setRevertConfirmTarget(null)}
          onConfirm={() => {
            if (revertConfirmTarget) {
              onRevert(
                revertConfirmTarget.stepIndex,
                revertConfirmTarget.draftContent,
                revertConfirmTarget.draftMedia,
              );
            }
          }}
          files={revertConfirmTarget?.files ?? []}
          title="确认撤销"
          subtitle="确认撤回此步骤后，将对项目文件执行以下变更："
          confirmText="确认撤回 ↵"
          cancelText="取消"
        />
      </div>
      <ChatScrollSlider targetRef={scrollRef} />
    </div>
  );
}
