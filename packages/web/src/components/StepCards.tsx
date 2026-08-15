import { useMemo, useState, useRef, useEffect } from "react";
import {
  IconCopy,
  IconCheck,
  IconTerminalSquare,
  IconPencil,
  IconFileText,
  IconFileCode,
  IconReact,
  IconLock,
  IconMessageCircle,
  IconChevron,
  IconPrisma,
  IconBot,
} from "./Icons";
import type {
  AskQuestionEntry,
  AskQuestionOption,
  AskQuestionRequest,
  FilePermissionRequest,
  SubagentDisplayData,
  TrajectoryStep,
} from "../types";
import { subagentDataFromStep } from "../utils/subagents";
import { formatOptionTextZh, formatQuestionTitleZh } from "../utils/stepCards";
import { copyText } from "../utils/clipboard";
import { triggerHaptic } from "../utils/haptics";

/** Inline copy button for step cards */
export function StepCopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action-btn step-copy-btn"
      title="复制"
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((success) => {
          if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

// ── File Permission Card ──

/** Check if a trajectory step is currently waiting for user interaction */
export function isStepWaiting(step: TrajectoryStep): boolean {
  if (step.completedInteractions && step.completedInteractions.length > 0) {
    return false;
  }
  const s = String(step.status ?? "").toUpperCase();
  if (
    s.includes("DONE") ||
    s.includes("COMPLETE") ||
    s.includes("CANCEL") ||
    s.includes("ERROR")
  ) {
    return false;
  }
  return true;
}

/** Permission scope enum values matching the LS proto */
const PERMISSION_SCOPE_ONCE = 1;
const PERMISSION_SCOPE_CONVERSATION = 2;

interface FilePermissionCardProps {
  step: TrajectoryStep;
  permissionRequest: FilePermissionRequest;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
  onGenericPermission?: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
  ) => Promise<void>;
}

export function FilePermissionCard({
  step,
  permissionRequest,
  onFilePermission,
  onGenericPermission,
}: FilePermissionCardProps) {
  const [responded, setResponded] = useState(false);
  const isWaiting = isStepWaiting(step);
  const [expanded, setExpanded] = useState(isWaiting);
  const usesGenericPermission = permissionRequest.responseKind === "permission";

  const trajectoryId =
    (step as any).trajectoryId ??
    (step.metadata as any)?.trajectoryId ??
    step.metadata?.sourceTrajectoryStepInfo?.trajectoryId ??
    "active";
  const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;

  const path = permissionRequest.absolutePathUri;
  const displayPath = path.length > 60 ? "…" + path.slice(-55) : path;
  const isDir = permissionRequest.isDirectory ?? false;

  const handleResponse = (allow: boolean, scope: number) => {
    setResponded(true);
    setExpanded(false);
    if (usesGenericPermission) {
      void onGenericPermission?.(trajectoryId, stepIndex, allow);
      return;
    }
    onFilePermission(trajectoryId, stepIndex, allow, scope, path);
  };

  const canRespond = !usesGenericPermission || !!onGenericPermission;

  return (
    <div
      className={`chat-block step-card file-permission-card ${responded ? "cmd-ok" : isWaiting ? "cmd-wait" : ""}`}
    >
      <div
        className="step-card-header"
        onClick={() => setExpanded((prev) => !prev)}
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
      >
        <span className="step-card-icon">
          <IconLock size={12} />
        </span>
        <span className="step-card-desc">
          {permissionRequest.action === "write_file"
            ? "请求写入文件："
            : permissionRequest.action === "read_file"
              ? "请求读取文件："
              : "请求文件访问权限："}
          <code className="step-card-file">{displayPath}</code>
          {isDir ? " (目录)" : ""}
        </span>
        <span className="step-card-toggle">
          <IconChevron
            size={14}
            className={`step-chevron-icon ${expanded ? "expanded" : ""}`}
          />
        </span>
      </div>
      {expanded && permissionRequest.blockReason && (
        <div className="step-card-cwd">
          {permissionRequest.blockReason
            .replace("BLOCK_REASON_", "")
            .replace(/_/g, " ")
            .toLowerCase()}
        </div>
      )}
      {expanded && isWaiting && !responded && canRespond && (
        <div className="step-card-actions file-permission-actions">
          <button
            className="approve-btn file-permission-btn deny"
            onClick={() => handleResponse(false, 0)}
          >
            拒绝
          </button>
          {usesGenericPermission ? (
            <button
              className="approve-btn file-permission-btn allow-conversation"
              onClick={() => handleResponse(true, 0)}
            >
              允许
            </button>
          ) : (
            <>
              <button
                className="approve-btn file-permission-btn allow-once"
                onClick={() => handleResponse(true, PERMISSION_SCOPE_ONCE)}
              >
                允许本次
              </button>
              <button
                className="approve-btn file-permission-btn allow-conversation"
                onClick={() =>
                  handleResponse(true, PERMISSION_SCOPE_CONVERSATION)
                }
              >
                在本次对话中始终允许
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ask Question Card ──

interface AskQuestionCardProps {
  step: TrajectoryStep;
  askQuestionRequest: AskQuestionRequest;
  fallbackStepIndex: number;
  onAskQuestion?: (
    trajectoryId: string,
    stepIndex: number,
    responses: AskQuestionEntry[],
    cancelled?: boolean,
  ) => Promise<void>;
}

function optionId(
  questionIndex: number,
  optionIndex: number,
  option: AskQuestionOption,
): string {
  return option.id ?? option.text ?? `${questionIndex}-${optionIndex}`;
}

function isWriteInOption(option: AskQuestionOption): boolean {
  if (option.id === "__write_in__") return true;
  return /\b(other|custom|write|替代|补充|其他|自定)\b/i.test(
    option.text ?? "",
  );
}

function responseFromQuestion(
  question: AskQuestionEntry,
  selectedOptionIds: string[],
  writeInResponse: string,
  skipped = false,
): AskQuestionEntry {
  const cleanSelectedOptionIds = selectedOptionIds.filter(
    (id) => id !== "__write_in__",
  );
  return {
    question: question.question,
    options: question.options,
    isMultiSelect: question.isMultiSelect,
    selectedOptionIds: cleanSelectedOptionIds,
    ...(writeInResponse.trim()
      ? { writeInResponse: writeInResponse.trim() }
      : {}),
    ...(skipped ? { skipped: true } : {}),
  };
}

export function AskQuestionCard({
  step,
  askQuestionRequest,
  fallbackStepIndex,
  onAskQuestion,
}: AskQuestionCardProps) {
  const questions = useMemo(
    () => askQuestionRequest.questions ?? [],
    [askQuestionRequest.questions],
  );
  const [selectedByQuestion, setSelectedByQuestion] = useState<
    Record<number, string[]>
  >(() =>
    Object.fromEntries(
      questions.map((question, index) => {
        const defaultIds = question.selectedOptionIds ?? [];
        if (
          defaultIds.length === 0 &&
          question.options &&
          question.options.length > 0 &&
          !question.isMultiSelect
        ) {
          // Pre-select first option (e.g. 允许本次)
          return [index, [optionId(index, 0, question.options[0])]];
        }
        return [index, defaultIds];
      }),
    ),
  );
  const [writeIns, setWriteIns] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      questions.map((question, index) => [
        index,
        question.writeInResponse ?? "",
      ]),
    ),
  );
  const [responded, setResponded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isWaiting = isStepWaiting(step);
  const [expanded, setExpanded] = useState(isWaiting);

  const trajectoryId =
    (step as any).trajectoryId ??
    (step.metadata as any)?.trajectoryId ??
    step.metadata?.sourceTrajectoryStepInfo?.trajectoryId ??
    "active";
  const stepIndex =
    step.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
    (step as any).stepIndex ??
    fallbackStepIndex;
  const canRespond =
    isWaiting && !responded && !!onAskQuestion && !!trajectoryId;

  const isPermissionStyle = questions.some(
    (q) =>
      /allow|permission|url|mcp|access|安全|权限|网址|工具/i.test(
        q.question ?? "",
      ) || step.requestedInteraction?.permission !== undefined,
  );

  const selectedSummary = useMemo(() => {
    const labels: string[] = [];
    questions.forEach((q, idx) => {
      const sel = selectedByQuestion[idx] ?? [];
      const rawOpts = q.options ?? [];
      const hasExplicitWriteIn = rawOpts.some(isWriteInOption);
      const opts =
        rawOpts.length > 0 && !hasExplicitWriteIn
          ? [
              ...rawOpts,
              {
                id: "__write_in__",
                text: "其他 (手动输入替代指示或补充说明)",
              },
            ]
          : rawOpts;

      sel.forEach((sId) => {
        const matched = opts.find(
          (opt, optIdx) => optionId(idx, optIdx, opt) === sId,
        );
        if (matched) {
          if (sId === "__write_in__") {
            labels.push(
              writeIns[idx]?.trim()
                ? `其他: ${writeIns[idx].trim()}`
                : "其他 (手动输入)",
            );
          } else {
            labels.push(formatOptionTextZh(matched.text ?? sId));
          }
        }
      });
      if (writeIns[idx]?.trim() && !sel.includes("__write_in__")) {
        labels.push(writeIns[idx].trim());
      }
    });
    return labels.join(", ") || (responded ? "已确认" : "");
  }, [questions, selectedByQuestion, writeIns, responded]);

  const hasAnswer =
    questions.length > 0 &&
    questions.every((_, index) => {
      const selected = selectedByQuestion[index] ?? [];
      const writeIn = writeIns[index]?.trim() ?? "";
      const onlyWriteInSelected =
        selected.length === 1 && selected[0] === "__write_in__";
      if (onlyWriteInSelected) {
        return writeIn.length > 0;
      }
      return selected.length > 0 || writeIn.length > 0;
    });

  const setOptionSelected = (
    questionIndex: number,
    option: AskQuestionOption,
    optionIndex: number,
    isMultiSelect: boolean,
  ) => {
    const id = optionId(questionIndex, optionIndex, option);
    setSelectedByQuestion((prev) => {
      const existing = prev[questionIndex] ?? [];
      if (!isMultiSelect) {
        return { ...prev, [questionIndex]: [id] };
      }
      return {
        ...prev,
        [questionIndex]: existing.includes(id)
          ? existing.filter((value) => value !== id)
          : [...existing, id],
      };
    });
  };

  const buildResponses = (skipped = false): AskQuestionEntry[] =>
    questions.map((question, index) =>
      responseFromQuestion(
        question,
        skipped ? [] : selectedByQuestion[index] ?? [],
        skipped ? "" : writeIns[index] ?? "",
        skipped,
      ),
    );

  const handleSubmit = async (skipped = false) => {
    if (!onAskQuestion || !canRespond || submitting) return;
    setSubmitting(true);
    setResponded(true);
    setExpanded(false);
    try {
      await onAskQuestion(trajectoryId, stepIndex, buildResponses(skipped));
    } catch {
      setResponded(false);
      setSubmitting(false);
      setExpanded(true);
    }
  };

  return (
    <div
      className={`chat-block step-card ask-question-card ${responded ? "cmd-ok" : isWaiting ? "cmd-wait" : ""} ${!expanded ? "is-collapsed" : ""}`}
    >
      <div
        className="step-card-header ask-question-header"
        onClick={() => setExpanded((prev) => !prev)}
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
      >
        <span className="step-card-icon">
          {isPermissionStyle ? <IconLock size={12} /> : <IconMessageCircle size={12} />}
        </span>
        <span className="step-card-desc">
          {isPermissionStyle
            ? responded || !isWaiting
              ? "安全审批已确认"
              : "安全审批与权限确认"
            : responded || !isWaiting
              ? "输入已确认"
              : "等待输入确认"}
          {!expanded && selectedSummary && (
            <span className="ask-question-summary-badge">{selectedSummary}</span>
          )}
        </span>
        <span className="step-card-toggle">
          <IconChevron
            size={14}
            className={`step-chevron-icon ${expanded ? "expanded" : ""}`}
          />
        </span>
      </div>

      {expanded && (
        <>
          <div className="ask-question-body">
            {questions.map((question, questionIndex) => {
              const rawOptions = question.options ?? [];
              const hasExplicitWriteIn = rawOptions.some(isWriteInOption);
              const options: AskQuestionOption[] =
                rawOptions.length > 0 && !hasExplicitWriteIn
                  ? [
                      ...rawOptions,
                      {
                        id: "__write_in__",
                        text: "其他 (手动输入替代指示或补充说明)",
                      },
                    ]
                  : rawOptions;

              const selected = selectedByQuestion[questionIndex] ?? [];
              const isCustomSelected = selected.includes("__write_in__");
              const showWriteIn =
                options.length === 0 ||
                isCustomSelected ||
                Boolean(writeIns[questionIndex]?.trim()) ||
                options.some((option, optionIndex) => {
                  const id = optionId(questionIndex, optionIndex, option);
                  return selected.includes(id) && isWriteInOption(option);
                });

              const [mainText, ...targetLines] = (question.question ?? "").split("\n");
              const targetBadge = targetLines.join("\n").trim();

              return (
                <div className="ask-question" key={questionIndex}>
                  {question.question && (
                    <div className="ask-question-text">
                      <div className="ask-question-title">
                        {formatQuestionTitleZh(mainText)}
                      </div>
                      {targetBadge && (
                        <div className="ask-question-target-badge">
                          <code>{targetBadge}</code>
                        </div>
                      )}
                    </div>
                  )}
                  {options.length > 0 && (
                    <div className="ask-question-options">
                      {options.map((option, optionIndex) => {
                        const id = optionId(questionIndex, optionIndex, option);
                        const active = selected.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`ask-question-option ${active ? "active" : ""}`}
                            disabled={!canRespond}
                            onClick={() =>
                              setOptionSelected(
                                questionIndex,
                                option,
                                optionIndex,
                                !!question.isMultiSelect,
                              )
                            }
                          >
                            <span className="ask-question-option-index">
                              {optionIndex + 1}
                            </span>
                            <span className="ask-question-option-text">
                              {formatOptionTextZh(option.text ?? id)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {showWriteIn && (
                    <textarea
                      className="ask-question-write-in"
                      aria-label="自定义补充说明"
                      placeholder="请输入替代指示或补充说明..."
                      value={writeIns[questionIndex] ?? ""}
                      disabled={!canRespond}
                      autoFocus={isCustomSelected}
                      onChange={(event) =>
                        setWriteIns((prev) => ({
                          ...prev,
                          [questionIndex]: event.target.value,
                        }))
                      }
                      rows={2}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {canRespond && (
            <div className="step-card-actions ask-question-actions">
              <button
                className="approve-btn ask-question-btn skip"
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit(true)}
              >
                跳过
              </button>
              <button
                className="approve-btn ask-question-btn submit"
                type="button"
                disabled={!hasAnswer || submitting}
                onClick={() => void handleSubmit(false)}
              >
                确认提交
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Command Card ──

interface CommandCardProps {
  step: TrajectoryStep;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
}

export function CommandCard({ step, onCommandAction }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [responded, setResponded] = useState(false);
  const cmd = step.runCommand;
  if (!cmd) return null;

  const isWaiting = isStepWaiting(step);
  // When waiting for approval, show the proposed command; otherwise show executed
  const command = isWaiting
    ? (cmd.proposedCommandLine ?? cmd.commandLine ?? cmd.command ?? "")
    : (cmd.commandLine ?? cmd.command ?? "");
  const output = cmd.combinedOutput?.full ?? cmd.output ?? "";
  const exitCode = cmd.exitCode;

  const trajectoryId =
    (step as any).trajectoryId ??
    (step.metadata as any)?.trajectoryId ??
    step.metadata?.sourceTrajectoryStepInfo?.trajectoryId ??
    "active";
  const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;

  const statusClass = isWaiting
    ? "cmd-wait"
    : exitCode === undefined
      ? ""
      : exitCode === 0
        ? "cmd-ok"
        : "cmd-fail";

  const handleAction = async (approved: boolean) => {
    if (!onCommandAction) return;
    setResponded(true);
    try {
      await onCommandAction(trajectoryId, stepIndex, approved);
    } catch {
      // Request failed — restore buttons so user can retry
      setResponded(false);
    }
  };

  const labelText = isWaiting ? "等待执行" : "已执行";

  return (
    <div className={`zcode-command-row-container ${statusClass}`}>
      <button
        className="zcode-command-header-btn"
        onClick={() => setExpanded((v) => !v)}
        type="button"
        aria-expanded={expanded}
      >
        <div className="zcode-command-header-left">
          <span className="zcode-command-terminal-icon">
            <IconTerminalSquare size={14} />
          </span>
          <span className="zcode-command-status-label">{labelText}</span>
          {expanded ? (
            <span className="zcode-command-chevron open">
              <IconChevron size={11} />
            </span>
          ) : (
            <span className="zcode-command-preview-text">{command}</span>
          )}
        </div>
      </button>

      {/* Expanded Terminal Container */}
      {expanded && (
        <div className="zcode-command-terminal-box">
          <div className="zcode-command-prompt-line">
            <span className="zcode-command-prompt-symbol">$</span>
            <code className="step-card-command zcode-command-full">{command}</code>
          </div>

          {output && (
            <pre className="zcode-command-output-body">{output}</pre>
          )}

          {isWaiting && !responded && onCommandAction && (
            <div className="step-card-actions command-action-bar" style={{ marginTop: 8, borderRadius: 6 }}>
              <span className="command-waiting-label">
                <span className="waiting-dot" />
                Waiting for approval
              </span>
              <div className="command-action-buttons">
                <button
                  className="approve-btn command-action-btn reject"
                  onClick={() => handleAction(false)}
                >
                  Reject
                </button>
                <button
                  className="approve-btn command-action-btn approve"
                  onClick={() => handleAction(true)}
                >
                  Approve
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action bar if waiting and collapsed */}
      {!expanded && isWaiting && !responded && onCommandAction && (
        <div className="step-card-actions command-action-bar" style={{ marginTop: 6, borderRadius: 6 }}>
          <span className="command-waiting-label">
            <span className="waiting-dot" />
            Waiting for approval
          </span>
          <div className="command-action-buttons">
            <button
              className="approve-btn command-action-btn reject"
              onClick={() => handleAction(false)}
            >
              Reject
            </button>
            <button
              className="approve-btn command-action-btn approve"
              onClick={() => handleAction(true)}
            >
              Approve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Code Action Card ──

interface CodeActionCardProps {
  step: TrajectoryStep;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
}

/** Diff line types from the LS proto */
type DiffLineType =
  | "UNIFIED_DIFF_LINE_TYPE_UNCHANGED"
  | "UNIFIED_DIFF_LINE_TYPE_INSERT"
  | "UNIFIED_DIFF_LINE_TYPE_DELETE"
  | "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER";

interface DiffLine {
  text?: string;
  type: DiffLineType;
}

function getFileTypeIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "prisma") {
    return <IconPrisma size={13} className="code-action-file-icon prisma" style={{ color: "#10b981" }} />;
  }
  if (ext === "tsx" || ext === "jsx") {
    return <IconReact size={13} className="code-action-file-icon react" />;
  }
  if (ext === "ts" || ext === "mts") {
    return <IconFileCode size={13} className="code-action-file-icon ts" style={{ color: "#60a5fa" }} />;
  }
  if (ext === "js" || ext === "mjs") {
    return <IconFileCode size={13} className="code-action-file-icon js" style={{ color: "#facc15" }} />;
  }
  if (ext === "css" || ext === "scss" || ext === "less") {
    return <IconFileCode size={13} className="code-action-file-icon css" style={{ color: "#38bdf8" }} />;
  }
  if (ext === "json") {
    return <IconFileCode size={13} className="code-action-file-icon json" style={{ color: "#fbbf24" }} />;
  }
  if (ext === "html") {
    return <IconFileCode size={13} className="code-action-file-icon html" style={{ color: "#fb923c" }} />;
  }
  if (ext === "md") {
    return <IconFileText size={13} className="code-action-file-icon md" style={{ color: "#94a3b8" }} />;
  }
  return <IconFileCode size={13} className="code-action-file-icon default" style={{ color: "#9ca3af" }} />;
}

interface InlineDiffLine {
  type: "insert" | "delete" | "unchanged";
  text: string;
  lineNum: number;
}

function highlightDiffTokens(text: string) {
  if (!text) return " ";
  const parts = text.split(
    /('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|\b(?:import|export|from|type|const|let|var|function|return|interface|class|model|enum|if|else|switch|case|default|try|catch|finally|async|await|extends|implements|public|private|protected|readonly|static|as|new|this|super|typeof|instanceof|void|null|undefined|boolean|string|number)\b)/g,
  );

  return parts.map((part, idx) => {
    if (/^['"`]/.test(part)) {
      return (
        <span key={idx} className="zcode-diff-token-string">
          {part}
        </span>
      );
    }
    if (
      /^(?:import|export|from|type|const|let|var|function|return|interface|class|model|enum|if|else|switch|case|default|try|catch|finally|async|await|extends|implements|public|private|protected|readonly|static|as|new|this|super|typeof|instanceof|void|null|undefined|boolean|string|number)$/.test(
        part,
      )
    ) {
      return (
        <span key={idx} className="zcode-diff-token-keyword">
          {part}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function useAnimatedNumber(target: number, minDuration: number = 600): number {
  const [count, setCount] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = target;
    prevRef.current = target;

    if (start === end) {
      setCount(end);
      return;
    }

    const duration = Math.min(1100, Math.max(minDuration, Math.abs(end - start) * 5));
    const startTime = performance.now();
    let animId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * ease);
      setCount(current);

      if (progress < 1) {
        animId = requestAnimationFrame(tick);
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [target, minDuration]);

  return count;
}

export function CodeActionCard({ step }: CodeActionCardProps) {
  const ca = step.codeAction;
  if (!ca) return null;

  const [expanded, setExpanded] = useState(false);
  const isEditing =
    step.status === "CORTEX_STEP_STATUS_RUNNING" ||
    step.status === "CORTEX_STEP_STATUS_GENERATING" ||
    step.status === "CORTEX_STEP_STATUS_PENDING" ||
    step.status === "CORTEX_STEP_STATUS_QUEUED";

  const toolCallAny = step.metadata?.toolCall as any;
  let rawPath =
    ca.actionResult?.edit?.absoluteUri ||
    toolCallAny?.args?.TargetFile ||
    toolCallAny?.args?.targetFile ||
    toolCallAny?.args?.file_path ||
    toolCallAny?.args?.path ||
    toolCallAny?.arguments?.TargetFile ||
    toolCallAny?.arguments?.targetFile ||
    "";

  try {
    rawPath = decodeURIComponent(rawPath);
  } catch {}

  const cleanPath = rawPath.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
  const fileName = cleanPath.split("/").pop() || "file";

  // Format clean directory path (matching desktop IDE style)
  let fileDir = "";
  const pkgIdx = cleanPath.indexOf("packages/");
  const srcIdx = cleanPath.indexOf("src/");
  if (pkgIdx !== -1) {
    const sub = cleanPath.slice(pkgIdx);
    const parts = sub.split("/");
    fileDir = parts.slice(0, -1).join("/") + "/";
  } else if (srcIdx !== -1) {
    const sub = cleanPath.slice(srcIdx);
    const parts = sub.split("/");
    fileDir = parts.slice(0, -1).join("/") + "/";
  } else {
    const parts = cleanPath.split("/").filter(Boolean);
    const dirParts = parts.slice(0, -1);
    if (dirParts.length > 0) {
      fileDir = dirParts.slice(-3).join("/") + "/";
    }
  }

  const rawDiffLines: DiffLine[] =
    ca.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];

  const inlineDiffLines = useMemo<InlineDiffLine[]>(() => {
    const result: InlineDiffLine[] = [];

    if (rawDiffLines.length > 0) {
      let currentLine = 1;
      for (const l of rawDiffLines) {
        if (l.type === "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER") {
          const match = (l.text ?? "").match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            currentLine = parseInt(match[1], 10);
          }
          continue;
        }
        if (l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT") {
          result.push({
            type: "insert",
            text: l.text ?? "",
            lineNum: currentLine++,
          });
        } else if (l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE") {
          result.push({
            type: "delete",
            text: l.text ?? "",
            lineNum: currentLine,
          });
        } else if (l.type === "UNIFIED_DIFF_LINE_TYPE_UNCHANGED") {
          currentLine++;
        }
      }
    } else {
      // Fallback to toolCall args
      const chunks = toolCallAny?.args?.ReplacementChunks || toolCallAny?.arguments?.ReplacementChunks;
      const codeContent =
        toolCallAny?.args?.CodeContent ||
        toolCallAny?.args?.code_content ||
        toolCallAny?.arguments?.CodeContent;

      if (Array.isArray(chunks) && chunks.length > 0) {
        for (const ch of chunks) {
          const startLine = typeof ch.StartLine === "number" ? ch.StartLine : 1;
          if (ch.TargetContent) {
            const tLines = String(ch.TargetContent).split("\n");
            tLines.forEach((tl, idx) => {
              result.push({
                type: "delete",
                text: tl,
                lineNum: startLine + idx,
              });
            });
          }
          if (ch.ReplacementContent) {
            const rLines = String(ch.ReplacementContent).split("\n");
            rLines.forEach((rl, idx) => {
              result.push({
                type: "insert",
                text: rl,
                lineNum: startLine + idx,
              });
            });
          }
        }
      } else if (codeContent) {
        const cLines = String(codeContent).split("\n");
        cLines.forEach((cl, idx) => {
          result.push({
            type: "insert",
            text: cl,
            lineNum: idx + 1,
          });
        });
      } else {
        const target = toolCallAny?.args?.TargetContent || toolCallAny?.args?.targetContent;
        const replacement = toolCallAny?.args?.ReplacementContent || toolCallAny?.args?.replacementContent;
        const startLine = typeof toolCallAny?.args?.StartLine === "number" ? toolCallAny.args.StartLine : 1;

        if (target || replacement) {
          if (target) {
            const tLines = String(target).split("\n");
            tLines.forEach((tl, idx) => {
              result.push({
                type: "delete",
                text: tl,
                lineNum: startLine + idx,
              });
            });
          }
          if (replacement) {
            const rLines = String(replacement).split("\n");
            rLines.forEach((rl, idx) => {
              result.push({
                type: "insert",
                text: rl,
                lineNum: startLine + idx,
              });
            });
          }
        }
      }
    }

    return result;
  }, [rawDiffLines, toolCallAny]);

  // Count additions/deletions
  const additions = inlineDiffLines.filter((l) => l.type === "insert").length;
  const deletions = inlineDiffLines.filter((l) => l.type === "delete").length;

  const displayAdditions = useAnimatedNumber(additions, 650);
  const displayDeletions = useAnimatedNumber(deletions, 650);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("light");
    setExpanded((v) => !v);
  };

  return (
    <div className="zcode-code-action-wrapper">
      {/* Header Row */}
      <div
        className={`zcode-inline-code-action ${isEditing ? "is-editing" : ""}`}
        onClick={handleToggle}
        title={expanded ? "点击收起修改内容" : "点击展开修改内容"}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle(e as any);
          }
        }}
      >
        <div className="zcode-code-action-left">
          <IconPencil size={13} className={`zcode-code-action-pencil ${isEditing ? "is-editing" : ""}`} />
          <span className="zcode-code-action-label">
            {isEditing ? "正在编辑" : "已编辑"}
          </span>
          <span className="zcode-code-action-file-badge">
            {getFileTypeIcon(fileName)}
            <span className="zcode-code-action-filename">{fileName}</span>
          </span>
          {fileDir && (
            <span className="zcode-code-action-dir" title={fileDir}>
              {fileDir}
            </span>
          )}
        </div>

        <div className="zcode-code-action-right">
          {additions > 0 && (
            <span className="zcode-stat-add">+{displayAdditions}</span>
          )}
          {deletions > 0 && (
            <span className="zcode-stat-del">-{displayDeletions}</span>
          )}
          {additions === 0 && deletions === 0 && (
            <span className="zcode-stat-neutral">
              {isEditing ? "+..." : "0"}
            </span>
          )}
          <span className="zcode-code-action-chevron-wrap">
            <IconChevron
              size={11}
              className={`zcode-code-action-chevron ${expanded ? "expanded" : ""}`}
            />
          </span>
        </div>
      </div>

      {/* Expanded Inline Diff Box (1:1 Antigravity Desktop - Only Changed Lines) */}
      {expanded && inlineDiffLines.length > 0 && (
        <div className="zcode-inline-diff-box">
          {inlineDiffLines.map((line, idx) => (
            <div key={idx} className={`zcode-inline-diff-line ${line.type}`}>
              <div className="zcode-inline-diff-bar" />
              <div className="zcode-inline-diff-num">{idx + 1}</div>
              <div className="zcode-inline-diff-text">
                {highlightDiffTokens(line.text)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subagent Card ──

const ACTIVE_SUBAGENT_STATUSES = new Set([
  "CORTEX_STEP_STATUS_GENERATING",
  "CORTEX_STEP_STATUS_QUEUED",
  "CORTEX_STEP_STATUS_PENDING",
  "CORTEX_STEP_STATUS_RUNNING",
  "CORTEX_STEP_STATUS_WAITING",
]);

const FAILED_SUBAGENT_STATUSES = new Set([
  "CORTEX_STEP_STATUS_INVALID",
  "CORTEX_STEP_STATUS_CANCELED",
  "CORTEX_STEP_STATUS_ERROR",
  "CORTEX_STEP_STATUS_INTERRUPTED",
]);

interface SubagentCardProps {
  step: TrajectoryStep;
  data?: SubagentDisplayData;
  onSelectSubagent?: (id: string) => void;
}

export function SubagentCard({ step, data, onSelectSubagent }: SubagentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const display = data ?? subagentDataFromStep(step);
  if (!display) return null;

  const isInvoke = display.kind === "invoke";

  const isFailed =
    step.status === "ERROR" ||
    step.status === "CORTEX_STEP_STATUS_ERROR" ||
    FAILED_SUBAGENT_STATUSES.has(step.status || "");

  const isRunning =
    step.status === "RUNNING" ||
    ACTIVE_SUBAGENT_STATUSES.has(step.status || "");

  return (
    <div className="zcode-subagent-card-wrap">
      {display.items.map((item, itemIndex) => {
        const role = item.role || "subagent";
        const convId =
          (step.metadata as any)?.childConversationId ||
          (step as any).conversationId ||
          (step.invokeSubagent as any)?.conversationId;
        const subagentId =
          convId ||
          `subagent-${step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? itemIndex}-${itemIndex}-${role.replace(/\s+/g, "_")}`;

        return (
          <div
            key={`${role}-${itemIndex}`}
            className={`zcode-subagent-list-row ${isFailed ? "is-failed" : isRunning ? "is-running" : ""} ${!isInvoke ? "is-meta-action" : ""}`}
            onClick={() => {
              triggerHaptic("light");
              if (isInvoke && onSelectSubagent) {
                onSelectSubagent(subagentId);
              } else {
                setExpanded((v) => !v);
              }
            }}
            role="button"
            tabIndex={0}
            title={isInvoke ? `点击进入子智能体: ${role}` : "点击展开详细信息"}
          >
            <div className="zcode-subagent-row-left">
              <IconBot size={14} className="subagent-row-bot-icon" />
              <span className="subagent-row-prefix">
                {isInvoke
                  ? "子智能体"
                  : display.kind === "manage"
                    ? "智能体管理"
                    : display.kind === "define"
                      ? "定义智能体"
                      : "智能体消息"}
              </span>
              <span className="subagent-row-typename">{item.typeName || "subagent"}</span>
              <span className="subagent-row-sep">·</span>
              <span className="subagent-row-role" title={role}>{role}</span>
              {isFailed && <span className="subagent-row-failed-tag">执行失败</span>}
              {isRunning && <span className="subagent-row-running-tag">执行中</span>}
            </div>

            <div className="zcode-subagent-row-right">
              <span className="subagent-row-hint">{isInvoke ? "查看对话" : "查看详情"}</span>
              <IconChevron size={12} className={`subagent-row-arrow ${expanded ? "expanded" : ""}`} />
            </div>
          </div>
        );
      })}

      {expanded && (
        <div className="subagent-details-inline">
          {display.items.map((item, itemIndex) => (
            <div key={itemIndex}>
              {item.details.map((detail, dIdx) => (
                <div key={dIdx} className="subagent-detail-item">
                  <div className="subagent-detail-label">{detail.label}:</div>
                  <pre className="subagent-detail-pre">{detail.text}</pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
