import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import React from "react";
import {
  IconFileCode,
  IconCopy,
  IconCheck,
  IconX,
  IconSparkles,
  IconRefresh,
  IconSpinner,
  IconChevron,
  IconMessageSquare,
  IconFilePlus,
  IconTerminalSquare,
  IconSend,
  IconGitBranch,
  IconUpload,
  IconDownload,
  IconRotateCcw,
  IconPlus,
  IconTrash,
  IconPrisma,
  IconReact,
  IconFileText,
  IconChevronsDown,
  IconMoreHorizontal,
  IconWrapText,
  IconCopyLayers,
  IconSearch,
  IconCloud,
  IconBot,
} from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";
import type { TrajectoryStep, ChatMessage } from "../types";
import { api, resolveWsUrl } from "../api/client";
import { renderMarkdown } from "../utils/markdown";
import { MarkdownContent } from "./MarkdownContent";
import { extractArtifactsFromSteps } from "../utils/extractArtifacts";
import { useSubagentViewer } from "../hooks/useSubagentViewer";
import { useStepsStream } from "../hooks/useStepsStream";
import { SubagentDetailViewer } from "./SubagentDetailViewer";
import { SubagentDirectoryView } from "./SubagentDirectoryView";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export type SidePanelTab = "chat" | "review" | "git" | "terminal" | "artifacts" | "subagent" | "subagent_directory";

interface Props {
  cascadeId?: string | null;
  steps?: TrajectoryStep[];
  messages?: ChatMessage[];
  workspaceUri?: string;
  projectName?: string;
  selectedFile?: { name: string; path?: string; ext?: string; range?: string } | null;
  activeSubagentId?: string | null;
  onSelectSubagent?: (id: string) => void;
  onClose?: () => void;
  initialTab?: SidePanelTab | null;
}

// Side-by-Side Diff Line Parser
interface DiffLine {
  type: "add" | "del" | "ctx" | "header";
  leftNum?: number;
  rightNum?: number;
  leftText?: string;
  rightText?: string;
}

function parseSideBySideDiff(rawDiff: string): DiffLine[] {
  if (!rawDiff) return [];
  const lines = rawDiff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "header", leftText: line, rightText: line });
    } else if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff --git") || line.startsWith("index ")) {
      result.push({ type: "header", leftText: line, rightText: line });
    } else if (line.startsWith("-")) {
      result.push({
        type: "del",
        leftNum: oldLine++,
        leftText: line.slice(1),
        rightText: "",
      });
    } else if (line.startsWith("+")) {
      result.push({
        type: "add",
        rightNum: newLine++,
        leftText: "",
        rightText: line.slice(1),
      });
    } else if (line.startsWith(" ")) {
      result.push({
        type: "ctx",
        leftNum: oldLine++,
        rightNum: newLine++,
        leftText: line.slice(1),
        rightText: line.slice(1),
      });
    } else if (line.trim().length > 0) {
      result.push({
        type: "ctx",
        leftNum: oldLine++,
        rightNum: newLine++,
        leftText: line,
        rightText: line,
      });
    }
  }

  return result;
}

interface SideQuestionCardData {
  id: string;
  query: string;
  response: string;
  time: string;
  status: "thinking" | "done" | "error";
  collapsed?: boolean;
  suggestedCommit?: string;
}

/** 1. 辅助对话 View (Official Antigravity Native /btw Side Question Architecture) */
function SideChatView({
  cascadeId,
  steps = [],
  workspaceUri,
  onBack,
  onClose,
  queuedPrompt,
  onClearQueuedPrompt,
  onApplyCommitMsg,
}: {
  cascadeId?: string | null;
  steps?: TrajectoryStep[];
  workspaceUri?: string;
  onBack?: () => void;
  onClose?: () => void;
  queuedPrompt?: string | null;
  onClearQueuedPrompt?: () => void;
  onApplyCommitMsg?: (msg: string) => void;
}) {
  const [localPendingQuestions, setLocalPendingQuestions] = useState<SideQuestionCardData[]>([]);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extract all /btw side questions directly from current trajectory steps
  const extractedQuestions = useMemo<SideQuestionCardData[]>(() => {
    if (!steps || steps.length === 0) return [];
    const list: SideQuestionCardData[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const userPrompt = step.userInput || (step as any).userPrompt;
      const userText =
        (Array.isArray(userPrompt?.items)
          ? userPrompt.items.map((it: any) => it.text || "").join("\n")
          : "") ||
        userPrompt?.text ||
        "";

      if (userText.trim().startsWith("/btw")) {
        const queryText = userText.trim().replace(/^\/btw\s*/i, "");
        let responseText = "";
        let isDone = false;

        for (let j = i + 1; j < steps.length; j++) {
          const nextStep = steps[j];
          const nextUserPrompt = nextStep.userInput || (nextStep as any).userPrompt;
          if (nextUserPrompt) break;

          if (nextStep.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
            const pr = nextStep.plannerResponse;
            const itemsText = Array.isArray(pr?.items)
              ? pr.items
                  .map((it: any) => (typeof it === "string" ? it : it?.text || it?.content || ""))
                  .filter(Boolean)
                  .join("\n\n")
              : "";
            const candidate =
              pr?.modifiedResponse?.trim() ||
              itemsText?.trim() ||
              (nextStep as any).userOutput?.output?.trim() ||
              (typeof (pr as any)?.response === "string" ? (pr as any).response.trim() : "") ||
              "";

            if (candidate) {
              responseText = candidate;
              isDone = true;
              break;
            }
          }
        }

        const cardId = `sq-step-${i}`;
        const commitMatch =
          /(?:```(?:text|bash)?\n)?\b(feat|fix|refactor|docs|style|test|chore|perf|ci)(?:\([a-zA-Z0-9_,-]+\))?:[^\n`]+(?:\n```)?/i.exec(
            responseText,
          );
        const suggestedCommit = commitMatch
          ? commitMatch[0].replace(/```(?:text|bash)?|```/g, "").trim()
          : responseText.startsWith("feat") ||
              responseText.startsWith("fix") ||
              responseText.startsWith("refactor") ||
              responseText.startsWith("chore")
            ? responseText
            : undefined;

        list.push({
          id: cardId,
          query: queryText,
          response: responseText,
          time: "本会话",
          status: isDone ? "done" : "thinking",
          suggestedCommit,
        });
      }
    }
    return list;
  }, [steps]);

  // Combine extracted trajectory questions with any local pending submissions
  const allQuestions = useMemo(() => {
    const combined = [...extractedQuestions];
    for (const pending of localPendingQuestions) {
      const alreadyInTrajectory = extractedQuestions.some(
        (eq) => eq.query === pending.query && (eq.status === "done" || Boolean(eq.response)),
      );
      if (!alreadyInTrajectory) {
        combined.push(pending);
      }
    }
    return combined;
  }, [extractedQuestions, localPendingQuestions]);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (typeof scrollRef.current.scrollTo === "function") {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allQuestions]);

  const handleAskQuestion = async (rawQuery: string) => {
    if (!rawQuery.trim()) return;
    const cleanQuery = rawQuery.trim().replace(/^\/btw\s*/i, "");
    setInput("");
    triggerHaptic("light");

    const newId = `sq-local-${Date.now()}`;
    const newCard: SideQuestionCardData = {
      id: newId,
      query: cleanQuery,
      response: "",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "thinking",
    };

    setLocalPendingQuestions((prev) => [...prev, newCard]);

    try {
      let targetId = cascadeId;
      if (!targetId) {
        const res = await api.startConversation(workspaceUri, true);
        targetId = res?.cascadeId || null;
      }

      if (targetId) {
        const fullBtwText = `/btw ${cleanQuery}`;
        const clientMsgId = `sq-${Date.now()}`;
        await api.sendMessage(
          targetId,
          [{ type: "text", text: fullBtwText }],
          clientMsgId,
          undefined,
          undefined,
          "conversational",
          true,
        );
      }
    } catch {
      setLocalPendingQuestions((prev) =>
        prev.map((q) =>
          q.id === newId
            ? { ...q, response: "抱歉，无法连接到模型服务，请检查网络或 Language Server 状态。", status: "error" }
            : q,
        ),
      );
    }
  };

  useEffect(() => {
    if (queuedPrompt) {
      const promptToRun = queuedPrompt;
      onClearQueuedPrompt?.();
      void handleAskQuestion(promptToRun);
    }
  }, [queuedPrompt]);

  const handleCopyText = (id: string, text: string) => {
    triggerHaptic("light");
    void copyText(text).then((ok) => {
      if (ok) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
      }
    });
  };

  const removeQuestion = (id: string) => {
    triggerHaptic("light");
    setLocalPendingQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  return (
    <div className="zcode-side-chat-container">
      {/* Header */}
      <div className="zcode-panel-header">
        <div className="zcode-panel-header-left">
          <IconMessageSquare size={14} style={{ color: "#38bdf8" }} />
          <span className="zcode-panel-header-title">辅助对话</span>
          {cascadeId && (
            <span
              className="vscode-branch-pill"
              style={{ fontSize: 10, background: "rgba(56, 189, 248, 0.12)", color: "#38bdf8" }}
              title={`当前绑定的会话 ID: ${cascadeId}`}
            >
              绑定当前会话 ({cascadeId.slice(0, 6)})
            </span>
          )}
        </div>
        <div className="zcode-panel-header-actions">
          {allQuestions.length > 0 && (
            <button
              className="zcode-panel-tool-btn"
              onClick={() => {
                triggerHaptic("light");
                setLocalPendingQuestions([]);
              }}
              title="清空当前辅助记录"
            >
              <IconTrash size={13} />
            </button>
          )}
          {onBack && (
            <button className="zcode-panel-tool-btn" onClick={onBack} title="切换面板">
              <IconChevron size={12} style={{ transform: "rotate(90deg)" }} />
            </button>
          )}
          {onClose && (
            <button className="zcode-panel-tool-btn" onClick={onClose} title="关闭面板">
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages Flow (Chat Stream Experience) */}
      <div className="zcode-side-chat-messages" ref={scrollRef} style={{ padding: "16px 14px", gap: "18px" }}>
        {allQuestions.length === 0 ? (
          <div className="vscode-empty-hint" style={{ padding: "36px 16px", textAlign: "center" }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: "rgba(56, 189, 248, 0.1)",
                color: "#38bdf8",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <IconMessageSquare size={20} />
            </div>
            <p className="vscode-empty-title" style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
              当前对话专属辅助助手
            </p>
            <p className="vscode-empty-desc" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 280, margin: "0 auto 16px auto" }}>
              提问自动在独立通道中执行，享有当前对话完整上下文与代码记忆，且绝不干扰主聊天流。
            </p>

            {/* Quick Suggestion Pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              <button
                className="zcode-quick-prompt-btn"
                onClick={() => void handleAskQuestion("帮我看看这个在写哪些代码")}
              >
                🔍 分析当前任务代码
              </button>
              <button
                className="zcode-quick-prompt-btn"
                onClick={() => void handleAskQuestion("根据当前代码改动生成 Conventional Commit 提交信息")}
              >
                📝 生成 Git Commit
              </button>
              <button
                className="zcode-quick-prompt-btn"
                onClick={() => void handleAskQuestion("请检查当前代码是否有潜在风险或可以重构的地方")}
              >
                💡 检查代码隐患
              </button>
            </div>
          </div>
        ) : (
          allQuestions.map((q) => {
            const renderedHtml = q.response ? renderMarkdown(q.response) : "";
            return (
              <div key={q.id} className="zcode-chat-flow-pair">
                {/* 1. User Question Bubble */}
                <div className="zcode-bubble-row user">
                  <div className="zcode-user-bubble">
                    <div className="zcode-user-bubble-badge">
                      <IconSparkles size={11} />
                      <span>Side Question</span>
                    </div>
                    <div className="zcode-user-bubble-text">{q.query}</div>
                  </div>
                </div>

                {/* 2. Assistant Response Bubble */}
                <div className="zcode-bubble-row assistant">
                  <div className="zcode-assistant-avatar">
                    <IconSparkles size={13} />
                  </div>
                  <div className="zcode-assistant-bubble">
                    {q.status === "thinking" && !q.response ? (
                      <div className="typing-indicator" style={{ padding: "4px 0" }}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      <>
                        {renderedHtml ? (
                          <div className="zcode-sq-markdown-content markdown-body">
                            <MarkdownContent html={renderedHtml} />
                          </div>
                        ) : (
                          <div className="zcode-plain-response">{q.response}</div>
                        )}

                        {/* Commit Generator Card Action */}
                        {q.suggestedCommit && onApplyCommitMsg && (
                          <div style={{ marginTop: 12 }}>
                            <button
                              className="zcode-apply-commit-btn"
                              onClick={() => {
                                triggerHaptic("medium");
                                onApplyCommitMsg(q.suggestedCommit!);
                              }}
                            >
                              <IconCheck size={13} />
                              <span>📥 一键填入 Git 提交框</span>
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {/* Bubble Bottom Actions */}
                    <div className="zcode-bubble-footer">
                      <span className="zcode-bubble-time">{q.time}</span>
                      <div className="zcode-bubble-actions">
                        <button
                          className="zcode-bubble-action-btn"
                          onClick={() => handleCopyText(q.id, q.response || q.query)}
                          title="复制内容"
                        >
                          {copiedId === q.id ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        </button>
                        <button
                          className="zcode-bubble-action-btn"
                          onClick={() => removeQuestion(q.id)}
                          title="删除此条问答"
                        >
                          <IconX size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Bar */}
      <div className="zcode-side-chat-input-bar">
        <textarea
          className="zcode-side-chat-textarea"
          placeholder="输入辅助提问或测试 Prompt (自动通过 /btw 执行)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleAskQuestion(input);
            }
          }}
          rows={2}
        />
        <button
          className="zcode-side-chat-send-btn"
          disabled={!input.trim()}
          onClick={() => void handleAskQuestion(input)}
          title="发送提问 (Enter)"
        >
          <IconSend size={15} />
        </button>
      </div>
    </div>
  );
}

function getFileTypeIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "prisma") {
    return <IconPrisma size={13} style={{ color: "#10b981", flexShrink: 0 }} />;
  }
  if (ext === "tsx" || ext === "jsx") {
    return <IconReact size={13} className="code-action-file-icon react" style={{ flexShrink: 0 }} />;
  }
  if (ext === "ts" || ext === "mts") {
    return <span className="vscode-ext-badge ts">TS</span>;
  }
  if (ext === "js" || ext === "mjs") {
    return <span className="vscode-ext-badge js">JS</span>;
  }
  if (ext === "css" || ext === "scss" || ext === "less") {
    return <IconFileCode size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />;
  }
  if (ext === "json") {
    return <IconFileCode size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />;
  }
  if (ext === "html") {
    return <IconFileCode size={13} style={{ color: "#fb923c", flexShrink: 0 }} />;
  }
  if (ext === "md") {
    return <IconFileText size={13} style={{ color: "#94a3b8", flexShrink: 0 }} />;
  }
  return <IconFileCode size={13} style={{ color: "#9ca3af", flexShrink: 0 }} />;
}

function highlightCodeTokens(lineText: string) {
  if (!lineText) return " ";

  const tokenRegex =
    /('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b(?:export|import|from|default|as|const|let|var|function|return|if|else|switch|case|break|continue|try|catch|finally|throw|new|class|interface|type|enum|extends|implements|public|private|protected|readonly|static|async|await|typeof|instanceof|void|never|this|super|null|undefined|true|false)\b|\b(?:string|number|boolean|any|unknown|symbol|bigint|object|Record|Array|Promise|Set|Map|Error|Prisma|PrismaClient|PrismaClientKnownRequestError)\b|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\())/g;

  const elements: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(lineText)) !== null) {
    if (match.index > lastIdx) {
      elements.push(lineText.slice(lastIdx, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("//") || token.startsWith("/*")) {
      elements.push(
        <span key={key} className="zcode-hl-comment">
          {token}
        </span>,
      );
    } else if (
      token.startsWith("'") ||
      token.startsWith('"') ||
      token.startsWith("`")
    ) {
      elements.push(
        <span key={key} className="zcode-hl-string">
          {token}
        </span>,
      );
    } else if (
      /^(?:export|import|from|default|as|const|let|var|function|return|if|else|switch|case|break|continue|try|catch|finally|throw|new|class|interface|type|enum|extends|implements|public|private|protected|readonly|static|async|await|typeof|instanceof|void|never|this|super|null|undefined|true|false)$/.test(
        token,
      )
    ) {
      elements.push(
        <span key={key} className="zcode-hl-keyword">
          {token}
        </span>,
      );
    } else if (
      /^(?:string|number|boolean|any|unknown|symbol|bigint|object|Record|Array|Promise|Set|Map|Error|Prisma|PrismaClient|PrismaClientKnownRequestError)$/.test(
        token,
      )
    ) {
      elements.push(
        <span key={key} className="zcode-hl-type">
          {token}
        </span>,
      );
    } else if (/^\d+(?:\.\d+)?$/.test(token)) {
      elements.push(
        <span key={key} className="zcode-hl-number">
          {token}
        </span>,
      );
    } else {
      elements.push(
        <span key={key} className="zcode-hl-function">
          {token}
        </span>,
      );
    }

    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < lineText.length) {
    elements.push(lineText.slice(lastIdx));
  }

  return elements;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "刚刚";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  return `${days}天`;
}

interface OpenFileTab {
  id: string;
  name: string;
  path: string;
  ext: string;
  range?: string;
  content?: string;
  diffText?: string;
  loading?: boolean;
  error?: string;
  openedAt?: number;
  lastAccessedAt?: number;
}

/** 2. 代码审查 View (Desktop IDE 1:1 Code Editor & Review Center) */
function SideReviewView({
  workspaceUri,
  steps = [],
  messages = [],
  selectedFile,
  subagentSessions = [],
  onSelectSubagent,
  onOpenSubagentDirectory,
  onBack,
  onClose,
}: {
  workspaceUri?: string;
  steps?: TrajectoryStep[];
  messages?: ChatMessage[];
  selectedFile?: { name: string; path?: string; ext?: string; range?: string; diffText?: string } | null;
  subagentSessions?: import("../hooks/useSubagentViewer").SubagentSession[];
  onSelectSubagent?: (id: string) => void;
  onOpenSubagentDirectory?: () => void;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const [fileTabs, setFileTabs] = useState<OpenFileTab[]>([]);
  const [recentlyClosedTabs, setRecentlyClosedTabs] = useState<
    Array<{ id: string; name: string; path: string; ext: string; diffText?: string; closedAt: number }>
  >([]);
  const [tabSearch, setTabSearch] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"code" | "diff">("code");
  const [showTabDropdown, setShowTabDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("split");
  const [mdViewMode, setMdViewMode] = useState<"preview" | "code">("preview");
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  const [gitFiles, setGitFiles] = useState<Array<{ status: string; path: string; staged: boolean }>>([]);
  const [gitLoading, setGitLoading] = useState(false);

  const artifactItems = useMemo(() => {
    const raw = extractArtifactsFromSteps(steps, messages);
    return raw.filter((a) => a.type === "diff" || a.type === "code");
  }, [steps, messages]);

  const fetchGitData = useCallback(async () => {
    setGitLoading(true);
    try {
      const statusRes = await api.gitStatus(workspaceUri);
      setGitFiles(statusRes.files || []);
    } catch {
      // ignore
    } finally {
      setGitLoading(false);
    }
  }, [workspaceUri]);

  useEffect(() => {
    fetchGitData();
  }, [fetchGitData]);

  const openFileInTab = useCallback(
    async (file: { name: string; path?: string; ext?: string; range?: string; diffText?: string }) => {
      const rawPath = file.path || file.name;
      const cleanPath = rawPath.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
      const fileName = file.name || cleanPath.split("/").pop() || "file";
      const ext = file.ext || fileName.split(".").pop() || "";
      const tabId = cleanPath;
      const now = Date.now();

      setFileTabs((prev) => {
        const existingIdx = prev.findIndex((t) => t.id === tabId || t.path === cleanPath);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            range: file.range,
            diffText: file.diffText || updated[existingIdx].diffText,
            lastAccessedAt: now,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: tabId,
            name: fileName,
            path: cleanPath,
            ext,
            range: file.range,
            diffText: file.diffText,
            loading: true,
            openedAt: now,
            lastAccessedAt: now,
          },
        ];
      });
      setActiveTabId(tabId);
      setRecentlyClosedTabs((prev) => prev.filter((t) => t.path !== cleanPath));

      try {
        const res = await api.readFileText(cleanPath, workspaceUri);
        if (res && typeof res.content === "string") {
          setFileTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, content: res.content, loading: false, error: undefined } : t,
            ),
          );
        } else if (file.diffText) {
          setFileTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, content: file.diffText, loading: false, error: undefined } : t,
            ),
          );
        } else {
          setFileTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, loading: false, error: res.error || "未找到文件内容" } : t,
            ),
          );
        }
      } catch (err: any) {
        if (file.diffText) {
          setFileTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, content: file.diffText, loading: false } : t,
            ),
          );
        } else {
          setFileTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, loading: false, error: err.message || "读取失败" } : t,
            ),
          );
        }
      }
    },
    [workspaceUri],
  );

  useEffect(() => {
    if (selectedFile?.name || selectedFile?.path) {
      openFileInTab(selectedFile);
    }
  }, [selectedFile, openFileInTab]);

  const activeTab = useMemo(() => {
    return fileTabs.find((t) => t.id === activeTabId) || fileTabs[0] || null;
  }, [fileTabs, activeTabId]);

  const isMarkdownFile = useMemo(() => {
    if (!activeTab) return false;
    const ext = (activeTab.ext || "").toLowerCase() || (activeTab.name.split(".").pop() || "").toLowerCase();
    return ext === "md" || ext === "markdown" || ext === "mdown" || ext === "mkd";
  }, [activeTab]);

  const breadcrumbSegments = useMemo(() => {
    if (!activeTab?.path) return ["工作区"];
    let clean = activeTab.path.replace(/\\/g, "/");
    const parts = clean.split("/").filter(Boolean);
    if (parts.length > 5) {
      return [parts[0].replace(/:$/, ""), "...", ...parts.slice(-4)];
    }
    return parts;
  }, [activeTab?.path]);

  const highlightRange = useMemo(() => {
    if (!activeTab?.range) return null;
    const match = activeTab.range.match(/(\d+)(?:-(\d+))?/);
    if (!match) return null;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    return { start, end };
  }, [activeTab?.range]);

  useEffect(() => {
    if (highlightRange?.start && targetLineRef.current) {
      setTimeout(() => {
        targetLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }
  }, [highlightRange, activeTab?.content]);

  const codeLines = useMemo(() => {
    if (!activeTab?.content) return [];
    return activeTab.content.split("\n");
  }, [activeTab?.content]);

  const handleCloseTab = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    triggerHaptic("light");

    const tabToClose = fileTabs.find((t) => t.id === id);
    if (tabToClose) {
      setRecentlyClosedTabs((prev) => [
        {
          id: tabToClose.id,
          name: tabToClose.name,
          path: tabToClose.path,
          ext: tabToClose.ext,
          diffText: tabToClose.diffText,
          closedAt: Date.now(),
        },
        ...prev.filter((t) => t.path !== tabToClose.path).slice(0, 19),
      ]);
    }

    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        onClose?.();
        setActiveTabId(null);
      } else if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  };

  const filteredOpenTabs = useMemo(() => {
    const q = tabSearch.trim().toLowerCase();
    if (!q) return fileTabs;
    return fileTabs.filter(
      (t) => t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q),
    );
  }, [fileTabs, tabSearch]);

  const filteredClosedTabs = useMemo(() => {
    const q = tabSearch.trim().toLowerCase();
    if (!q) return recentlyClosedTabs;
    return recentlyClosedTabs.filter(
      (t) => t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q),
    );
  }, [recentlyClosedTabs, tabSearch]);

  const filteredSubagents = useMemo(() => {
    const q = tabSearch.trim().toLowerCase();
    if (!q) return subagentSessions;
    return subagentSessions.filter(
      (s) =>
        s.role.toLowerCase().includes(q) ||
        s.typeName.toLowerCase().includes(q) ||
        (s.output && s.output.toLowerCase().includes(q)),
    );
  }, [subagentSessions, tabSearch]);

  const handleSplitDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDraggingSplit(true);
    triggerHaptic("light");

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const clientX =
        "touches" in moveEvent
          ? moveEvent.touches[0].clientX
          : (moveEvent as MouseEvent).clientX;

      const relativeX = clientX - rect.left;
      const percentage = (relativeX / rect.width) * 100;
      const clamped = Math.max(15, Math.min(85, percentage));
      setSplitRatio(clamped);
    };

    const onEnd = () => {
      setIsDraggingSplit(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const sideBySideLines = useMemo(
    () => parseSideBySideDiff(activeTab?.diffText || ""),
    [activeTab?.diffText],
  );

  const handleCopyCode = () => {
    if (activeTab?.content) {
      triggerHaptic("light");
      void copyText(activeTab.content);
    }
  };

  return (
    <div className="vscode-editor-root">
      <div className="vscode-editor-tab-bar">
        <div style={{ position: "relative" }}>
          <button
            className={`vscode-editor-tab-dropdown-btn ${showTabDropdown ? "active" : ""}`}
            onClick={() => {
              setShowTabDropdown((v) => !v);
              setTabSearch("");
            }}
            title="搜索并切换标签页"
          >
            <IconChevronsDown size={13} />
          </button>

          {showTabDropdown && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 998 }}
                onClick={() => setShowTabDropdown(false)}
              />
              <div className="vscode-editor-dropdown-menu">
                {/* Search Bar */}
                <div className="vscode-tab-dropdown-search-wrap">
                  <IconSearch size={13} className="vscode-tab-search-icon" />
                  <input
                    type="text"
                    className="vscode-tab-search-input"
                    placeholder="搜索标签页..."
                    value={tabSearch}
                    onChange={(e) => setTabSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Section 1: 打开的标签页 */}
                {filteredOpenTabs.length > 0 && (
                  <>
                    <div className="vscode-tab-dropdown-section-title">打开的标签页</div>
                    {filteredOpenTabs.map((t) => {
                      const isActive = t.id === activeTabId;
                      return (
                        <div
                          key={t.id}
                          className={`vscode-tab-dropdown-row ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setActiveTabId(t.id);
                            setShowTabDropdown(false);
                          }}
                        >
                          <span className="vscode-tab-row-icon">{getFileTypeIcon(t.name)}</span>
                          <span className="vscode-tab-row-name" title={t.name}>{t.name}</span>
                          <span className="vscode-tab-row-time">{formatRelativeTime(t.lastAccessedAt || t.openedAt)}</span>
                          <button
                            className="vscode-tab-row-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseTab(t.id, e);
                            }}
                            title="关闭标签页"
                          >
                            <IconX size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Divider between sections if both have items */}
                {filteredOpenTabs.length > 0 && filteredClosedTabs.length > 0 && (
                  <div className="vscode-menu-divider" style={{ margin: "6px 2px" }} />
                )}

                {/* Section 2: 最近关闭的标签页 */}
                {filteredClosedTabs.length > 0 && (
                  <>
                    <div className="vscode-tab-dropdown-section-title">最近关闭的标签页</div>
                    {filteredClosedTabs.map((t, idx) => (
                      <div
                        key={`${t.path}-${idx}`}
                        className="vscode-tab-dropdown-row closed"
                        onClick={() => {
                          openFileInTab({ name: t.name, path: t.path, ext: t.ext, diffText: t.diffText });
                          setRecentlyClosedTabs((prev) => prev.filter((_, i) => i !== idx));
                          setShowTabDropdown(false);
                        }}
                        title={`重新打开 ${t.name}`}
                      >
                        <span className="vscode-tab-row-icon">{getFileTypeIcon(t.name)}</span>
                        <span className="vscode-tab-row-name" title={t.name}>{t.name}</span>
                        <span className="vscode-tab-row-time">{formatRelativeTime(t.closedAt)}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Section 3: 子智能体 */}
                {filteredSubagents.length > 0 && (
                  <>
                    {(filteredOpenTabs.length > 0 || filteredClosedTabs.length > 0) && (
                      <div className="vscode-menu-divider" style={{ margin: "6px 2px" }} />
                    )}
                    <div className="vscode-tab-dropdown-section-title">
                      子智能体 ({filteredSubagents.length})
                    </div>
                    {onOpenSubagentDirectory && (
                      <div
                        className="vscode-tab-dropdown-row"
                        onClick={() => {
                          onOpenSubagentDirectory();
                          setShowTabDropdown(false);
                        }}
                      >
                        <span className="vscode-tab-row-icon">
                          <IconBot size={13} style={{ color: "#818cf8" }} />
                        </span>
                        <span className="vscode-tab-row-name" style={{ color: "#818cf8", fontWeight: 500 }}>
                          打开子智能体目录 ({subagentSessions.length})
                        </span>
                      </div>
                    )}
                    {filteredSubagents.map((s) => (
                      <div
                        key={s.id}
                        className={`vscode-tab-dropdown-row ${s.status === "running" ? "active" : ""}`}
                        onClick={() => {
                          onSelectSubagent?.(s.id);
                          setShowTabDropdown(false);
                        }}
                      >
                        <span className="vscode-tab-row-icon">
                          <IconBot
                            size={13}
                            style={{ color: s.status === "running" ? "#818cf8" : undefined }}
                          />
                        </span>
                        <span className="vscode-tab-row-name" title={s.role}>{s.role}</span>
                        <span className="vscode-tab-row-time">
                          {s.status === "running" ? "执行中" : s.status === "failed" ? "失败" : "已完成"}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {/* Empty State */}
                {filteredOpenTabs.length === 0 &&
                  filteredClosedTabs.length === 0 &&
                  filteredSubagents.length === 0 && (
                    <div className="vscode-tab-dropdown-empty">
                      {tabSearch ? "未找到匹配的标签页或子智能体" : "暂无已打开或最近关闭的标签页"}
                    </div>
                  )}
              </div>
            </>
          )}
        </div>

        <div className="vscode-editor-tabs-scroll">
          {fileTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`vscode-editor-tab ${isActive ? "active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
                title={tab.path}
              >
                {getFileTypeIcon(tab.name)}
                <span className="vscode-editor-tab-title">{tab.name}</span>
                <button
                  className="vscode-editor-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="关闭标签"
                >
                  <IconX size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          className="vscode-editor-tab-add"
          onClick={() => {
            if (gitFiles.length > 0) {
              openFileInTab({ name: gitFiles[0].path.split("/").pop() || "file", path: gitFiles[0].path });
            }
          }}
          title="新建/打开文件"
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div className="vscode-editor-breadcrumb-bar">
        <div className="vscode-breadcrumb-path">
          {breadcrumbSegments.map((seg, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="vscode-breadcrumb-sep">›</span>}
              <span className={`vscode-breadcrumb-item ${idx === breadcrumbSegments.length - 1 ? "current" : ""}`}>
                {idx === breadcrumbSegments.length - 1 && activeTab && (
                  <span style={{ marginRight: 4 }}>{getFileTypeIcon(activeTab.name)}</span>
                )}
                {seg}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className="vscode-breadcrumb-actions">
          {isMarkdownFile && !activeTab?.diffText && (
            <div className="vscode-breadcrumb-mode-toggle">
              <button
                className={`vscode-mode-pill ${mdViewMode === "preview" ? "active" : ""}`}
                onClick={() => {
                  setMdViewMode("preview");
                  triggerHaptic("light");
                }}
                title="预览渲染后的 Markdown 格式"
              >
                预览
              </button>
              <button
                className={`vscode-mode-pill ${mdViewMode === "code" ? "active" : ""}`}
                onClick={() => {
                  setMdViewMode("code");
                  triggerHaptic("light");
                }}
                title="查看 Markdown 源码"
              >
                源码
              </button>
            </div>
          )}

          {activeTab?.diffText && (
            <div className="vscode-breadcrumb-mode-toggle">
              <button
                className={`vscode-mode-pill ${editorMode === "code" ? "active" : ""}`}
                onClick={() => setEditorMode("code")}
              >
                代码
              </button>
              <button
                className={`vscode-mode-pill ${editorMode === "diff" ? "active" : ""}`}
                onClick={() => setEditorMode("diff")}
              >
                差异
              </button>
            </div>
          )}

          {editorMode === "diff" && (
            <div className="vscode-breadcrumb-mode-toggle">
              <button
                className={`vscode-mode-pill ${diffViewMode === "unified" ? "active" : ""}`}
                onClick={() => setDiffViewMode("unified")}
              >
                单栏
              </button>
              <button
                className={`vscode-mode-pill ${diffViewMode === "split" ? "active" : ""}`}
                onClick={() => setDiffViewMode("split")}
              >
                分栏
              </button>
            </div>
          )}

          <button className="vscode-breadcrumb-btn" onClick={handleCopyCode} title="复制当前文件内容">
            <IconCopy size={13} />
          </button>

          <div style={{ position: "relative" }}>
            <button
              className={`vscode-breadcrumb-btn ${showMoreMenu ? "active" : ""}`}
              onClick={() => setShowMoreMenu((v) => !v)}
              title="更多选项"
            >
              <IconMoreHorizontal size={14} />
            </button>

            {showMoreMenu && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 998 }}
                  onClick={() => setShowMoreMenu(false)}
                />
                <div className="vscode-breadcrumb-dropdown-menu">
                  <button
                    className={`vscode-menu-item ${wordWrap ? "active" : ""}`}
                    onClick={() => {
                      setWordWrap((v) => !v);
                      setShowMoreMenu(false);
                      triggerHaptic("light");
                    }}
                  >
                    <IconWrapText size={14} className="vscode-menu-icon" />
                    <span>自动换行</span>
                    {wordWrap && <IconCheck size={12} style={{ marginLeft: "auto", color: "#38bdf8" }} />}
                  </button>

                  <div className="vscode-menu-divider" />

                  <button
                    className="vscode-menu-item"
                    onClick={() => {
                      if (activeTab?.path) {
                        void copyText(activeTab.path);
                        triggerHaptic("light");
                      }
                      setShowMoreMenu(false);
                    }}
                  >
                    <IconCopyLayers size={14} className="vscode-menu-icon" />
                    <span>复制绝对路径</span>
                  </button>

                  <button
                    className="vscode-menu-item"
                    onClick={() => {
                      if (activeTab?.path) {
                        let rel = activeTab.path;
                        if (workspaceUri) {
                          const cleanWs = workspaceUri.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
                          if (rel.startsWith(cleanWs)) {
                            rel = rel.slice(cleanWs.length).replace(/^\/+/, "");
                          }
                        }
                        void copyText(rel);
                        triggerHaptic("light");
                      }
                      setShowMoreMenu(false);
                    }}
                  >
                    <IconCopyLayers size={14} className="vscode-menu-icon" />
                    <span>复制相对路径</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {onBack && (
            <button className="vscode-breadcrumb-btn" onClick={onBack} title="返回">
              <IconChevron size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
          )}
          {onClose && (
            <button className="vscode-breadcrumb-btn" onClick={onClose} title="关闭侧边栏">
              <IconX size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="vscode-editor-body">
        {activeTab?.loading ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "#8e8e94", fontSize: 13, width: "100%" }}>
            <IconSpinner size={18} className="icon-spin" style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }} />
            正在读取 {activeTab.name}...
          </div>
        ) : activeTab?.error ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "#ef4444", fontSize: 13, width: "100%" }}>
            {activeTab.error}
          </div>
        ) : fileTabs.length === 0 ? (
          <div className="zcode-review-dashboard" style={{ width: "100%", height: "100%", overflowY: "auto" }}>
            <div className="zcode-review-summary-banner">
              <div>
                <div className="zcode-review-summary-title">代码审查中心</div>
                <div className="zcode-review-summary-sub">
                  {gitFiles.length === 0 && artifactItems.length === 0
                    ? "当前工作区暂无未审查的代码改动"
                    : `共有 ${gitFiles.length + artifactItems.length} 项变更待审查`}
                </div>
              </div>
              <button
                className="zcode-panel-tool-btn"
                title="刷新代码变更"
                onClick={fetchGitData}
                disabled={gitLoading}
              >
                <IconRefresh size={13} className={gitLoading ? "icon-spin" : ""} />
              </button>
            </div>

            <div className="vscode-section" style={{ marginBottom: 14 }}>
              <div className="vscode-section-header">
                <span className="vscode-section-name">工作区代码变更</span>
                <span className="vscode-section-count">({gitFiles.length})</span>
              </div>

              <div className="vscode-file-list">
                {gitFiles.length === 0 && artifactItems.length === 0 ? (
                  <div className="vscode-empty-hint" style={{ padding: "14px 10px" }}>
                    暂无未提交的文件变更，点击左侧对话中“已读取”的文件即可在编辑器中查看
                  </div>
                ) : (
                  gitFiles.map((file) => (
                    <div
                      key={file.path}
                      className="vscode-file-row"
                      onClick={() => openFileInTab({ name: file.path.split("/").pop() || "file", path: file.path })}
                      title="点击在编辑器中打开"
                    >
                      <div className="vscode-file-info">
                        <IconFileCode size={13} className="vscode-file-icon" />
                        <span className="vscode-file-name">{file.path.split("/").pop()}</span>
                        <span className="vscode-file-dir">{file.path.split("/").slice(0, -1).join("/")}</span>
                      </div>
                      <div className="vscode-file-actions">
                        <span className={`vscode-status-badge ${file.status.toLowerCase()}`}>{file.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {artifactItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 12px 24px" }}>
                <div className="vscode-section-header" style={{ padding: "4px 0" }}>
                  <span className="vscode-section-name">对话生成代码片段</span>
                  <span className="vscode-section-count">({artifactItems.length})</span>
                </div>
                {artifactItems.map((item) => (
                  <div
                    key={item.id}
                    className="zcode-review-item-card"
                    onClick={() => openFileInTab({ name: item.title, path: item.path || item.title, diffText: item.content })}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="zcode-review-item-header">
                      <div className="zcode-review-item-title-wrap">
                        <IconFileCode size={15} style={{ color: "#3b82f6" }} />
                        <span className="zcode-review-item-title" style={{ fontSize: 13, fontWeight: 600 }}>
                          {item.title}
                        </span>
                      </div>
                    </div>
                    <div className="zcode-review-item-body">
                      <pre className="artifact-card-code" style={{ maxHeight: 160, overflowY: "auto" }}>
                        <code>{item.content}</code>
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : editorMode === "diff" ? (
          diffViewMode === "split" && sideBySideLines.length > 0 ? (
            <div
              className={`vscode-split-diff-container ${isDraggingSplit ? "is-resizing" : ""} ${wordWrap ? "wrap-text" : ""}`}
              ref={splitContainerRef}
              style={{ width: "100%", height: "100%" }}
            >
              <div
                className="vscode-split-diff-column left"
                style={{ flex: `0 0 calc(${splitRatio}% - 6px)`, maxWidth: `calc(${splitRatio}% - 6px)` }}
              >
                <div className="vscode-split-diff-header">修改前</div>
                {sideBySideLines.map((line, i) => (
                  <div key={i} className={`vscode-split-diff-line ${line.type === "del" ? "del" : line.type === "header" ? "header" : "ctx"}`}>
                    <span className="vscode-split-diff-num">{line.leftNum ?? ""}</span>
                    <span className="vscode-split-diff-text">{line.leftText || " "}</span>
                  </div>
                ))}
              </div>

              <div
                className={`vscode-split-diff-divider ${isDraggingSplit ? "active" : ""}`}
                onMouseDown={handleSplitDragStart}
                onTouchStart={handleSplitDragStart}
                onDoubleClick={() => setSplitRatio(50)}
                title="左右拖动调整分栏比例"
              >
                <div className="vscode-split-diff-divider-handle" />
              </div>

              <div
                className="vscode-split-diff-column right"
                style={{ flex: `0 0 calc(${100 - splitRatio}% - 6px)`, maxWidth: `calc(${100 - splitRatio}% - 6px)` }}
              >
                <div className="vscode-split-diff-header">修改后</div>
                {sideBySideLines.map((line, i) => (
                  <div key={i} className={`vscode-split-diff-line ${line.type === "add" ? "add" : line.type === "header" ? "header" : "ctx"}`}>
                    <span className="vscode-split-diff-num">{line.rightNum ?? ""}</span>
                    <span className="vscode-split-diff-text">{line.rightText || " "}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <pre className="artifact-card-code" style={{ margin: 0, padding: 14, fontSize: "12.5px", width: "100%" }}>
              <code>{activeTab.diffText || "暂无差异内容"}</code>
            </pre>
          )
        ) : isMarkdownFile && mdViewMode === "preview" && !activeTab?.diffText ? (
          <div className="vscode-markdown-preview-container">
            <div className="vscode-markdown-rendered-content">
              <MarkdownContent html={renderMarkdown(activeTab?.content || "")} />
            </div>
          </div>
        ) : (
          /* Full Source Code View with Line Numbers & Syntax Tokens (1:1 with Screenshot) */
          <div style={{ display: "flex", width: "100%", height: "100%", overflow: "auto" }}>
            <div className="vscode-editor-gutter">
              {codeLines.map((_, idx) => {
                const lineNum = idx + 1;
                const isHighlighted = highlightRange && lineNum >= highlightRange.start && lineNum <= highlightRange.end;
                return (
                  <div key={idx} className={`vscode-editor-gutter-num ${isHighlighted ? "highlighted" : ""}`}>
                    {lineNum}
                  </div>
                );
              })}
            </div>
            <div className={`vscode-editor-lines ${wordWrap ? "wrap-text" : ""}`}>
              {codeLines.map((line, idx) => {
                const lineNum = idx + 1;
                const isHighlighted = highlightRange && lineNum >= highlightRange.start && lineNum <= highlightRange.end;
                const isFirstHighlighted = highlightRange && lineNum === highlightRange.start;
                return (
                  <div
                    key={idx}
                    ref={isFirstHighlighted ? targetLineRef : undefined}
                    className={`vscode-editor-code-line ${isHighlighted ? "highlighted" : ""}`}
                  >
                    {highlightCodeTokens(line)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseGitRefs(refsStr?: string): Array<{ type: "head" | "remote" | "tag" | "branch"; label: string }> {
  if (!refsStr) return [];
  const rawList = refsStr.split(",").map((s) => s.trim()).filter(Boolean);
  const result: Array<{ type: "head" | "remote" | "tag" | "branch"; label: string }> = [];

  for (const raw of rawList) {
    if (raw.startsWith("HEAD -> ")) {
      result.push({ type: "head", label: raw.replace("HEAD -> ", "").trim() });
    } else if (raw === "HEAD") {
      result.push({ type: "head", label: "HEAD" });
    } else if (raw.startsWith("tag: ")) {
      result.push({ type: "tag", label: raw.replace("tag: ", "").trim() });
    } else if (raw.startsWith("origin/") || raw.includes("/")) {
      result.push({ type: "remote", label: raw });
    } else {
      result.push({ type: "branch", label: raw });
    }
  }
  return result;
}

/** 3. 专属 Git 控制台 View (Clean, High-End Source Control UI) */
function SideGitView({
  workspaceUri,
  selectedFile,
  commitMsg: externalCommitMsg,
  setCommitMsg: externalSetCommitMsg,
  onBack,
  onClose,
}: {
  workspaceUri?: string;
  selectedFile?: { name: string; path?: string; ext?: string; range?: string } | null;
  commitMsg?: string;
  setCommitMsg?: React.Dispatch<React.SetStateAction<string>>;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const [gitFiles, setGitFiles] = useState<Array<{ status: string; path: string; staged: boolean }>>([]);
  const [gitLogs, setGitLogs] = useState<Array<{
    hash: string;
    message: string;
    author: string;
    relativeTime: string;
    date: string;
    refs?: string;
    isRemotePushed?: boolean;
    isHead?: boolean;
  }>>([]);
  const [gitBranch, setGitBranch] = useState("main");
  const [gitAhead, setGitAhead] = useState(0);
  const [gitBehind, setGitBehind] = useState(0);
  const [gitLoading, setGitLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Branch Selector Modal & Operations State
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const [branchFilterTab, setBranchFilterTab] = useState<"all" | "local" | "remote">("all");
  const [branchesData, setBranchesData] = useState<{
    current: string;
    local: Array<{ name: string; isCurrent: boolean; hash: string; subject: string }>;
    remote: Array<{ name: string; remote: string; branch: string; hash: string; subject: string }>;
  }>({ current: "main", local: [], remote: [] });
  const [branchLoading, setBranchLoading] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [internalCommitMsg, setInternalCommitMsg] = useState("");
  const commitMsg = externalCommitMsg !== undefined ? externalCommitMsg : internalCommitMsg;
  const setCommitMsg = externalSetCommitMsg || setInternalCommitMsg;
  const [committing, setCommitting] = useState(false);
  const [commitStatusMsg, setCommitStatusMsg] = useState<string | null>(null);

  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);
  const [activeDiffText, setActiveDiffText] = useState<string | null>(null);
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("split");
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(15);
  const [aiMsgLoading, setAiMsgLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const filteredLocalBranches = useMemo(() => {
    const q = branchSearchQuery.trim().toLowerCase();
    if (!q) return branchesData.local;
    return branchesData.local.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.subject.toLowerCase().includes(q) ||
        b.hash.toLowerCase().includes(q),
    );
  }, [branchesData.local, branchSearchQuery]);

  const filteredRemoteBranches = useMemo(() => {
    const q = branchSearchQuery.trim().toLowerCase();
    if (!q) return branchesData.remote;
    return branchesData.remote.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.subject.toLowerCase().includes(q) ||
        b.hash.toLowerCase().includes(q),
    );
  }, [branchesData.remote, branchSearchQuery]);

  const fetchBranches = useCallback(async () => {
    setBranchLoading(true);
    try {
      const res = await api.gitBranches(workspaceUri);
      if (res) {
        setBranchesData({
          current: res.current || gitBranch,
          local: res.local || [],
          remote: res.remote || [],
        });
        if (res.current) setGitBranch(res.current);
      }
    } catch {} finally {
      setBranchLoading(false);
    }
  }, [workspaceUri, gitBranch]);

  const handleSwitchBranch = async (branchName: string) => {
    triggerHaptic("medium");
    setBranchLoading(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitCheckout({ workspaceUri, branch: branchName });
      if (res.error) {
        setCommitStatusMsg(`切换分支失败: ${res.error}`);
      } else {
        setCommitStatusMsg(`✓ 已切换至分支: ${res.current || branchName}`);
        setGitBranch(res.current || branchName);
        setBranchModalOpen(false);
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`切换分支异常: ${(e as Error).message}`);
    } finally {
      setBranchLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    triggerHaptic("medium");
    setCreatingBranch(true);
    try {
      const res = await api.gitCreateBranch({
        workspaceUri,
        name: newBranchName.trim(),
        checkout: true,
      });
      if (res.error) {
        setCommitStatusMsg(`创建分支失败: ${res.error}`);
      } else {
        setCommitStatusMsg(`✓ 成功创建并切换至新分支: ${res.branch || newBranchName}`);
        setGitBranch(res.branch || newBranchName);
        setNewBranchName("");
        setShowNewBranchInput(false);
        setBranchModalOpen(false);
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`创建分支异常: ${(e as Error).message}`);
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleDeleteBranch = async (branchName: string, isRemote = false) => {
    if (!window.confirm(`确定要删除${isRemote ? "远程" : "本地"}分支 "${branchName}" 吗？`)) return;
    triggerHaptic("heavy");
    try {
      const res = await api.gitDeleteBranch({
        workspaceUri,
        name: branchName,
        force: true,
        isRemote,
      });
      if (res.error) {
        setCommitStatusMsg(`删除分支失败: ${res.error}`);
      } else {
        setCommitStatusMsg(`✓ 已删除分支: ${branchName}`);
        fetchBranches();
      }
    } catch (e) {
      setCommitStatusMsg(`删除分支异常: ${(e as Error).message}`);
    }
  };

  const handleFetchAll = async () => {
    triggerHaptic("light");
    setFetching(true);
    try {
      const res = await api.gitFetch({ workspaceUri, prune: true });
      if (res.error) {
        setCommitStatusMsg(`抓取远程失败: ${res.error}`);
      } else {
        setCommitStatusMsg("✓ 成功抓取最新远程分支与提交");
        fetchBranches();
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`抓取远程异常: ${(e as Error).message}`);
    } finally {
      setFetching(false);
    }
  };

  const handleSplitDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDraggingSplit(true);
    triggerHaptic("light");

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const clientX =
        "touches" in moveEvent
          ? moveEvent.touches[0].clientX
          : (moveEvent as MouseEvent).clientX;

      const relativeX = clientX - rect.left;
      const percentage = (relativeX / rect.width) * 100;
      const clamped = Math.max(15, Math.min(85, percentage));
      setSplitRatio(clamped);
    };

    const onEnd = () => {
      setIsDraggingSplit(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const fetchGitData = useCallback(async () => {
    setGitLoading(true);
    try {
      const [statusRes, logRes] = await Promise.allSettled([
        api.gitStatus(workspaceUri),
        api.gitLog(workspaceUri, historyLimit),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value) {
        setGitFiles(statusRes.value.files || []);
        if (statusRes.value.branch) setGitBranch(statusRes.value.branch);
        setGitAhead(statusRes.value.ahead || 0);
        setGitBehind(statusRes.value.behind || 0);
      }
      if (logRes.status === "fulfilled" && logRes.value) {
        setGitLogs(logRes.value.logs || []);
      }
    } catch {
      // fallback
    } finally {
      setGitLoading(false);
    }
  }, [workspaceUri, historyLimit]);

  useEffect(() => {
    fetchGitData();
  }, [fetchGitData]);

  useEffect(() => {
    if (selectedFile?.path) {
      handleInspectDiff(selectedFile.path, (selectedFile as any).diffText);
    }
  }, [selectedFile]);

  const handleCopyHash = (hash: string) => {
    triggerHaptic("light");
    copyText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handlePull = async () => {
    triggerHaptic("medium");
    setPulling(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitPull(workspaceUri);
      if (res.error) {
        setCommitStatusMsg(`拉取失败: ${res.error}`);
      } else {
        setCommitStatusMsg(`✓ 拉取成功: ${res.output?.trim() || "已是最新版本"}`);
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`拉取错误: ${(e as Error).message}`);
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async () => {
    triggerHaptic("medium");
    setPushing(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitPush({ workspaceUri, branch: gitBranch });
      if (res.error) {
        setCommitStatusMsg(`推送失败: ${res.error}`);
      } else {
        setCommitStatusMsg("✓ 推送至远端仓库成功!");
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`推送错误: ${(e as Error).message}`);
    } finally {
      setPushing(false);
    }
  };

  const handleStage = async (file: string) => {
    triggerHaptic("light");
    try {
      await api.gitStage(workspaceUri, file);
      fetchGitData();
    } catch (e) {
      setCommitStatusMsg(`暂存失败: ${(e as Error).message}`);
    }
  };

  const handleUnstage = async (file: string) => {
    triggerHaptic("light");
    try {
      await api.gitUnstage(workspaceUri, file);
      fetchGitData();
    } catch (e) {
      setCommitStatusMsg(`取消暂存失败: ${(e as Error).message}`);
    }
  };

  const handleStageAll = async () => {
    triggerHaptic("medium");
    try {
      await api.gitStage(workspaceUri, ".");
      setCommitStatusMsg("✓ 已暂存所有更改");
      fetchGitData();
    } catch (e) {
      setCommitStatusMsg(`暂存失败: ${(e as Error).message}`);
    }
  };

  const handleDiscard = async (file: string) => {
    if (!window.confirm(`确定要放弃对 "${file}" 的更改吗？`)) return;
    triggerHaptic("medium");
    try {
      await api.gitDiscard(workspaceUri, file);
      if (activeDiffFile === file) {
        setActiveDiffFile(null);
        setActiveDiffText(null);
      }
      fetchGitData();
    } catch (e) {
      setCommitStatusMsg(`放弃更改失败: ${(e as Error).message}`);
    }
  };

  const handleDiscardAll = async () => {
    if (!window.confirm("确定要放弃工作区的所有未提交改动吗？此操作无法撤销。")) return;
    triggerHaptic("heavy");
    try {
      await api.gitDiscard(workspaceUri);
      setActiveDiffFile(null);
      setActiveDiffText(null);
      setCommitStatusMsg("✓ 已放弃所有未提交更改");
      fetchGitData();
    } catch (e) {
      setCommitStatusMsg(`操作失败: ${(e as Error).message}`);
    }
  };

  const handleGenerateAiCommit = async (customPrompt?: string) => {
    triggerHaptic("medium");
    const userPromptStr = typeof customPrompt === "string" ? customPrompt : "";
    const rawInput = commitMsg.trim();
    const subPrompt =
      userPromptStr ||
      (rawInput.startsWith("/btw")
        ? rawInput.replace(/^\/btw\s*/, "")
        : "");

    setAiMsgLoading(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitAiCommit(workspaceUri, subPrompt);
      if (res && res.message) {
        setCommitMsg(res.message.trim());
        triggerHaptic("light");
      }
    } catch (err) {
      console.warn("AI Commit generation failed:", err);
      // Smart local Conventional Commit fallback if network fails
      const firstFile = gitFiles[0]?.path?.split("/").pop()?.replace(/\.[^.]+$/, "") || "codebase";
      setCommitMsg(`feat(${firstFile}): update and refine implementation`);
    } finally {
      setAiMsgLoading(false);
    }
  };

  const handleCommit = async (push = false) => {
    if (!commitMsg.trim()) return;
    triggerHaptic("medium");
    setCommitting(true);
    setCommitStatusMsg(null);
    try {
      const res = await api.gitCommit({
        workspaceUri,
        message: commitMsg.trim(),
        push,
      });
      if (res.error) {
        setCommitStatusMsg(`失败: ${res.error}`);
      } else {
        setCommitStatusMsg(push ? "✓ 提交并推送成功!" : "✓ 本地提交成功!");
        setCommitMsg("");
        fetchGitData();
      }
    } catch (e) {
      setCommitStatusMsg(`错误: ${(e as Error).message}`);
    } finally {
      setCommitting(false);
    }
  };

  const handleInspectDiff = async (file: string, fallbackDiffText?: string) => {
    triggerHaptic("light");
    setActiveCommitHash(null);
    if (activeDiffFile === file && !fallbackDiffText) {
      setActiveDiffFile(null);
      setActiveDiffText(null);
      return;
    }
    setActiveDiffFile(file);
    try {
      const res = await api.gitDiff(workspaceUri, file);
      if (res.diff && res.diff.trim()) {
        setActiveDiffText(res.diff);
      } else if (fallbackDiffText && fallbackDiffText.trim()) {
        setActiveDiffText(fallbackDiffText);
      } else {
        setActiveDiffText(res.diff || "暂无改动差异");
      }
    } catch {
      if (fallbackDiffText && fallbackDiffText.trim()) {
        setActiveDiffText(fallbackDiffText);
      } else {
        setActiveDiffText("读取差异失败");
      }
    }
  };

  const handleInspectCommitDiff = async (hash: string, message: string) => {
    triggerHaptic("light");
    const diffKey = `commit:${hash}`;
    if (activeCommitHash === hash && activeDiffFile === diffKey) {
      setActiveCommitHash(null);
      setActiveDiffFile(null);
      setActiveDiffText(null);
      return;
    }
    setActiveCommitHash(hash);
    setActiveDiffFile(diffKey);
    try {
      const res = await api.gitDiff(workspaceUri, { commit: hash });
      setActiveDiffText(res.diff || `提交 ${hash} (${message}) 无文件变动内容`);
    } catch {
      setActiveDiffText(`读取提交 ${hash} 差异失败`);
    }
  };

  const sideBySideLines = useMemo(() => parseSideBySideDiff(activeDiffText || ""), [activeDiffText]);

  return (
    <div className="zcode-git-console-root">
      {/* Top Header */}
      <div className="zcode-panel-header">
        <div className="zcode-panel-header-left">
          <IconGitBranch size={15} style={{ color: "#38bdf8" }} />
          <span className="zcode-panel-header-title">代码变更与 Git 控制台</span>
          {gitFiles.length > 0 && (
            <span className="vscode-count-badge">{gitFiles.length}</span>
          )}
        </div>
        <div className="zcode-panel-header-actions">
          <button
            className="zcode-panel-tool-btn"
            title="刷新 Git 状态与历史"
            onClick={fetchGitData}
            disabled={gitLoading}
          >
            <IconRefresh size={13} className={gitLoading ? "icon-spin" : ""} />
          </button>
          {onBack && (
            <button className="zcode-panel-tool-btn" onClick={onBack} title="切换面板">
              <IconChevron size={12} style={{ transform: "rotate(90deg)" }} />
            </button>
          )}
          {onClose && (
            <button className="zcode-panel-tool-btn" onClick={onClose} title="关闭面板">
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="zcode-git-console-body">
        {/* Branch & Sync Status Toolbar */}
        <div className="vscode-git-branch-bar">
          <div className="vscode-git-branch-left">
            <button
              className="vscode-branch-badge-btn"
              onClick={() => {
                setBranchModalOpen(true);
                fetchBranches();
              }}
              title="点击切换/新建分支或查看远程分支"
            >
              <IconGitBranch size={12} className="branch-icon" />
              <span className="branch-name-text">{gitBranch}</span>
              <IconChevron size={10} className="branch-chevron-down" />
            </button>
            {gitAhead > 0 && (
              <span className="vscode-sync-pill ahead" title={`${gitAhead} 个本地提交待推送到远端`}>
                <IconUpload size={11} /> {gitAhead}
              </span>
            )}
            {gitBehind > 0 && (
              <span className="vscode-sync-pill behind" title={`${gitBehind} 个远端提交待拉取`}>
                <IconDownload size={11} /> {gitBehind}
              </span>
            )}
          </div>
          <div className="vscode-git-branch-actions">
            <button
              className="vscode-sync-btn"
              onClick={handleFetchAll}
              disabled={fetching || gitLoading}
              title="抓取所有远端最新分支和提交 (git fetch --all)"
            >
              <IconRefresh size={11} className={fetching ? "icon-spin" : ""} />
              <span>抓取</span>
            </button>
            <button
              className="vscode-sync-btn"
              onClick={handlePull}
              disabled={pulling || gitLoading}
              title="从远端拉取最新代码 (git pull)"
            >
              <IconDownload size={12} className={pulling ? "icon-spin" : ""} />
              <span>拉取</span>
            </button>
            <button
              className="vscode-sync-btn"
              onClick={handlePush}
              disabled={pushing || gitLoading || (gitAhead === 0 && gitFiles.length === 0)}
              title="推送本地分支至远端 (git push)"
            >
              <IconUpload size={12} className={pushing ? "icon-spin" : ""} />
              <span>推送</span>
            </button>
          </div>
        </div>

        {/* Commit Message Box */}
        <div className="vscode-commit-box">
          <div className="vscode-commit-input-wrapper">
            <textarea
              className="vscode-commit-input"
              placeholder={aiMsgLoading ? "✨ 正在分析 Git 差异并生成提交信息..." : "提交信息 (Ctrl+Enter 提交，或输入 /btw 回车生成)..."}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              rows={3}
              disabled={aiMsgLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if (commitMsg.trim().startsWith("/btw") || commitMsg.trim() === "/btw") {
                    e.preventDefault();
                    handleGenerateAiCommit();
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    handleCommit(false);
                  }
                }
              }}
            />
            <button
              className="vscode-ai-btn"
              onClick={() => handleGenerateAiCommit()}
              disabled={aiMsgLoading || gitFiles.length === 0}
              title="点击 AI 自动分析 Git 变更并一键填入提交信息"
            >
              {aiMsgLoading ? (
                <IconSpinner size={12} className="icon-spin" />
              ) : (
                <IconSparkles size={12} />
              )}
              <span>AI 生成</span>
            </button>
          </div>

          <div className="vscode-commit-actions">
            <button
              className="vscode-commit-btn-secondary"
              onClick={() => handleCommit(true)}
              disabled={committing || !commitMsg.trim() || gitFiles.length === 0}
              title="一键提交并立即推送到远端仓库"
            >
              <IconUpload size={13} />
              <span>提交并推送</span>
            </button>
            <button
              className="vscode-commit-btn-primary"
              onClick={() => handleCommit(false)}
              disabled={committing || !commitMsg.trim() || gitFiles.length === 0}
              title="提交更改到本地仓库 (Ctrl+Enter)"
            >
              {committing ? <IconSpinner size={13} className="icon-spin" /> : <IconCheck size={13} />}
              <span>提交变更</span>
            </button>
          </div>

          {commitStatusMsg && (
            <div className={`vscode-status-banner ${commitStatusMsg.startsWith("✓") ? "success" : "error"}`}>
              {commitStatusMsg}
            </div>
          )}
        </div>

        {/* Changes Section */}
        <div className="vscode-section">
          <div
            className="vscode-section-header"
            onClick={() => setChangesCollapsed(!changesCollapsed)}
          >
            <IconChevron size={12} className={`vscode-chevron ${changesCollapsed ? "collapsed" : ""}`} />
            <span className="vscode-section-name">更改列表</span>
            <span className="vscode-section-count">({gitFiles.length})</span>
            {gitFiles.length > 0 && (
              <div className="vscode-section-actions-right" onClick={(e) => e.stopPropagation()}>
                <button
                  className="vscode-section-action-btn"
                  title="全部暂存"
                  onClick={handleStageAll}
                >
                  <IconPlus size={12} />
                </button>
                <button
                  className="vscode-section-action-btn"
                  title="放弃所有未提交更改"
                  onClick={handleDiscardAll}
                >
                  <IconRotateCcw size={12} />
                </button>
              </div>
            )}
          </div>

          {!changesCollapsed && (
            <div className="vscode-file-list">
              {gitFiles.length === 0 ? (
                <div className="vscode-empty-hint">工作区暂无未提交的代码变更</div>
              ) : (
                gitFiles.map((file) => (
                  <div
                    key={file.path}
                    className={`vscode-file-row ${activeDiffFile === file.path ? "active" : ""}`}
                    onClick={() => handleInspectDiff(file.path)}
                  >
                    <div className="vscode-file-info">
                      <IconFileCode size={13} className="vscode-file-icon" />
                      <span className="vscode-file-name" title={file.path}>
                        {file.path.split("/").pop()}
                      </span>
                      <span className="vscode-file-dir" title={file.path}>
                        {file.path.split("/").slice(0, -1).join("/")}
                      </span>
                    </div>
                    <div className="vscode-file-actions" onClick={(e) => e.stopPropagation()}>
                      <span className={`vscode-status-badge ${file.status.toLowerCase()}`}>
                        {file.status}
                      </span>
                      {file.staged ? (
                        <button
                          className="vscode-file-action-btn"
                          title="取消暂存"
                          onClick={() => handleUnstage(file.path)}
                        >
                          <IconX size={11} />
                        </button>
                      ) : (
                        <button
                          className="vscode-file-action-btn"
                          title="暂存更改"
                          onClick={() => handleStage(file.path)}
                        >
                          <IconPlus size={11} />
                        </button>
                      )}
                      <button
                        className="vscode-file-action-btn discard"
                        title="放弃修改"
                        onClick={() => handleDiscard(file.path)}
                      >
                        <IconRotateCcw size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Commit History (Graph Timeline) Section */}
        <div className="vscode-section">
          <div
            className="vscode-section-header"
            onClick={() => setHistoryCollapsed(!historyCollapsed)}
          >
            <IconChevron size={12} className={`vscode-chevron ${historyCollapsed ? "collapsed" : ""}`} />
            <IconGitBranch size={12} style={{ color: "#38bdf8" }} />
            <span className="vscode-section-name">提交历史</span>
            <span className="vscode-section-count">({gitLogs.length})</span>
            <div className="vscode-section-actions-right" onClick={(e) => e.stopPropagation()}>
              <button
                className="vscode-section-action-btn"
                title="刷新提交历史与分支图谱"
                onClick={fetchGitData}
                disabled={gitLoading}
              >
                <IconRefresh size={12} className={gitLoading ? "icon-spin" : ""} />
              </button>
            </div>
          </div>

          {!historyCollapsed && (
            <div className="vscode-git-graph-container">
              {/* Outgoing Header if ahead */}
              {gitAhead > 0 && (
                <div className="vscode-graph-outgoing-banner">
                  <div className="vscode-graph-spine-cell">
                    <div className="vscode-graph-node-dot outgoing" />
                    <div className="vscode-graph-spine-bottom" />
                  </div>
                  <div className="vscode-graph-outgoing-text">
                    <span className="outgoing-label">传出的更改</span>
                    <span className="outgoing-branch-pill">{gitBranch}</span>
                    <span className="outgoing-count-hint">({gitAhead} 个提交待推送)</span>
                  </div>
                </div>
              )}

              {gitLogs.length === 0 ? (
                <div className="vscode-empty-hint">暂无 Git 提交记录</div>
              ) : (
                gitLogs.map((log, index) => {
                  const isFirst = index === 0;
                  const isLast = index === gitLogs.length - 1;
                  const isHead = log.isHead || isFirst;
                  const isOutgoing = gitAhead > 0 && index < gitAhead;
                  const refBadges = parseGitRefs(log.refs);

                  return (
                    <div
                      key={log.hash}
                      className={`vscode-graph-item ${activeCommitHash === log.hash ? "active" : ""} ${isOutgoing ? "is-outgoing" : ""}`}
                      onClick={() => handleInspectCommitDiff(log.hash, log.message)}
                      title={`${log.hash} • ${log.author} • ${log.relativeTime}\n${log.message}`}
                    >
                      {/* Left Spine: Continuous Rail Line + Node Dot */}
                      <div className="vscode-graph-spine-cell">
                        <div className={`vscode-graph-spine-top ${isFirst && gitAhead === 0 ? "transparent" : ""}`} />
                        <div className={`vscode-graph-node-dot ${isHead ? "head" : isOutgoing ? "outgoing" : "solid"}`}>
                          {isHead ? <div className="vscode-graph-dot-inner" /> : null}
                        </div>
                        <div className={`vscode-graph-spine-bottom ${isLast ? "transparent" : ""}`} />
                      </div>

                      {/* Right Content: Message & Attached Ref Tags & Time/Hash */}
                      <div className="vscode-graph-row-content">
                        <div className="vscode-graph-row-top">
                          <span className="vscode-graph-msg-text">{log.message}</span>
                          {refBadges.map((badge, bIdx) => (
                            <span key={bIdx} className={`vscode-graph-ref-pill ${badge.type}`} title={badge.label}>
                              {badge.type === "head" && <span className="ref-dot head" />}
                              {badge.type === "remote" && <span className="ref-dot remote" />}
                              {badge.label}
                            </span>
                          ))}
                        </div>

                        <div className="vscode-graph-row-meta">
                          <span
                            className="vscode-graph-hash-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyHash(log.hash);
                            }}
                            title="点击复制 Hash"
                          >
                            {log.hash}
                            {copiedHash === log.hash && <span className="copied-text">✓ 已复制</span>}
                          </span>
                          <span className="vscode-graph-author-name">{log.author}</span>
                          <span className="vscode-graph-time-text">{log.relativeTime}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {gitLogs.length >= historyLimit && (
                <button
                  className="vscode-load-more-btn"
                  onClick={() => setHistoryLimit((prev) => prev + 15)}
                >
                  加载更多历史提交...
                </button>
              )}
            </div>
          )}
        </div>

        {/* Active Diff Inspector */}
        {activeDiffFile && (
          <div className="vscode-diff-inspector">
            <div className="vscode-diff-header">
              <div className="vscode-diff-title">
                <IconSparkles size={13} />
                <span>
                  {activeDiffFile.startsWith("commit:")
                    ? `提交差异: ${activeDiffFile.replace("commit:", "")}`
                    : `文件差异: ${activeDiffFile}`}
                </span>
              </div>
              <div className="vscode-diff-actions">
                <button
                  className={`vscode-diff-mode-btn ${diffViewMode === "unified" ? "active" : ""}`}
                  onClick={() => setDiffViewMode("unified")}
                >
                  单栏
                </button>
                <button
                  className={`vscode-diff-mode-btn ${diffViewMode === "split" ? "active" : ""}`}
                  onClick={() => setDiffViewMode("split")}
                >
                  分栏
                </button>
                <button
                  className="vscode-diff-close-btn"
                  onClick={() => {
                    setActiveDiffFile(null);
                    setActiveDiffText(null);
                    setActiveCommitHash(null);
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
            <div className="vscode-diff-body">
              {diffViewMode === "split" ? (
                <div
                  className={`vscode-split-diff-container ${isDraggingSplit ? "is-resizing" : ""}`}
                  ref={splitContainerRef}
                >
                  <div
                    className="vscode-split-diff-column left"
                    style={{ flex: `0 0 calc(${splitRatio}% - 6px)`, maxWidth: `calc(${splitRatio}% - 6px)` }}
                  >
                    <div className="vscode-split-diff-header">修改前</div>
                    {sideBySideLines.map((line, i) => (
                      <div key={i} className={`vscode-split-diff-line ${line.type === "del" ? "del" : line.type === "header" ? "header" : "ctx"}`}>
                        <span className="vscode-split-diff-num">{line.leftNum ?? ""}</span>
                        <span className="vscode-split-diff-text">{line.leftText || " "}</span>
                      </div>
                    ))}
                  </div>

                  {/* Draggable Split Divider */}
                  <div
                    className={`vscode-split-diff-divider ${isDraggingSplit ? "active" : ""}`}
                    onMouseDown={handleSplitDragStart}
                    onTouchStart={handleSplitDragStart}
                    onDoubleClick={() => setSplitRatio(50)}
                    title="左右拖动调整分栏比例 (双击重置为 50%)"
                  >
                    <div className="vscode-split-diff-divider-handle" />
                  </div>

                  <div
                    className="vscode-split-diff-column right"
                    style={{ flex: `0 0 calc(${100 - splitRatio}% - 6px)`, maxWidth: `calc(${100 - splitRatio}% - 6px)` }}
                  >
                    <div className="vscode-split-diff-header">修改后</div>
                    {sideBySideLines.map((line, i) => (
                      <div key={i} className={`vscode-split-diff-line ${line.type === "add" ? "add" : line.type === "header" ? "header" : "ctx"}`}>
                        <span className="vscode-split-diff-num">{line.rightNum ?? ""}</span>
                        <span className="vscode-split-diff-text">{line.rightText || " "}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <pre className="vscode-diff-pre">{activeDiffText}</pre>
              )}
            </div>
          </div>
        )}

        {/* ── Branch Selector Modal / Sheet ── */}
        {branchModalOpen && (
          <div className="vscode-branch-modal-backdrop" onClick={() => setBranchModalOpen(false)}>
            <div className="vscode-branch-modal" onClick={(e) => e.stopPropagation()}>
              <div className="vscode-branch-modal-header">
                <div className="vscode-branch-modal-title">
                  <IconGitBranch size={15} style={{ color: "#38bdf8" }} />
                  <span>选择或切换 Git 分支</span>
                </div>
                <div className="vscode-branch-modal-actions">
                  <button
                    className="vscode-icon-btn"
                    title="从远端抓取全部最新分支 (git fetch)"
                    onClick={handleFetchAll}
                    disabled={fetching}
                  >
                    <IconRefresh size={13} className={fetching ? "icon-spin" : ""} />
                  </button>
                  <button
                    className="vscode-icon-btn"
                    title="关闭"
                    onClick={() => setBranchModalOpen(false)}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              </div>

              {/* Search & New Branch Trigger Bar */}
              <div className="vscode-branch-search-bar">
                <div className="vscode-branch-search-input-wrap">
                  <IconSearch size={13} className="search-icon" />
                  <input
                    type="text"
                    className="vscode-branch-search-input"
                    placeholder="搜索本地或远程分支..."
                    value={branchSearchQuery}
                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {branchSearchQuery && (
                    <button className="search-clear-btn" onClick={() => setBranchSearchQuery("")}>
                      <IconX size={11} />
                    </button>
                  )}
                </div>
                <button
                  className={`vscode-branch-create-toggle-btn ${showNewBranchInput ? "active" : ""}`}
                  onClick={() => setShowNewBranchInput(!showNewBranchInput)}
                  title="从当前分支创建新分支"
                >
                  <IconPlus size={13} />
                  <span>新建分支</span>
                </button>
              </div>

              {/* Inline Create Branch Input */}
              {showNewBranchInput && (
                <div className="vscode-branch-create-inline">
                  <input
                    type="text"
                    className="vscode-branch-create-input"
                    placeholder="输入新分支名称 (如 feature/my-feature)..."
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateBranch();
                      if (e.key === "Escape") setShowNewBranchInput(false);
                    }}
                  />
                  <button
                    className="vscode-branch-submit-btn"
                    onClick={handleCreateBranch}
                    disabled={!newBranchName.trim() || creatingBranch}
                  >
                    {creatingBranch ? <IconSpinner size={12} className="icon-spin" /> : "创建并检出"}
                  </button>
                </div>
              )}

              {/* Filter Tabs: 全部 (All) | 本地分支 (Local) | 远程分支 (Remote) */}
              <div className="vscode-branch-tabs">
                <button
                  className={`vscode-branch-tab ${branchFilterTab === "all" ? "active" : ""}`}
                  onClick={() => setBranchFilterTab("all")}
                >
                  全部 ({filteredLocalBranches.length + filteredRemoteBranches.length})
                </button>
                <button
                  className={`vscode-branch-tab ${branchFilterTab === "local" ? "active" : ""}`}
                  onClick={() => setBranchFilterTab("local")}
                >
                  <IconGitBranch size={11} />
                  本地 ({filteredLocalBranches.length})
                </button>
                <button
                  className={`vscode-branch-tab ${branchFilterTab === "remote" ? "active" : ""}`}
                  onClick={() => setBranchFilterTab("remote")}
                >
                  <IconCloud size={11} />
                  远程 ({filteredRemoteBranches.length})
                </button>
              </div>

              {/* Branches List */}
              <div className="vscode-branch-list">
                {branchLoading ? (
                  <div className="vscode-branch-empty">
                    <IconSpinner size={16} className="icon-spin" />
                    <span>正在加载分支列表...</span>
                  </div>
                ) : (
                  <>
                    {/* Local Branches Section */}
                    {(branchFilterTab === "all" || branchFilterTab === "local") && (
                      <div className="vscode-branch-group">
                        <div className="vscode-branch-group-header">
                          <IconGitBranch size={12} />
                          <span>本地分支 ({filteredLocalBranches.length})</span>
                        </div>
                        {filteredLocalBranches.length === 0 ? (
                          <div className="vscode-branch-none">无匹配的本地分支</div>
                        ) : (
                          filteredLocalBranches.map((b) => {
                            const isCur = b.name === gitBranch || b.isCurrent;
                            return (
                              <div
                                key={`local-${b.name}`}
                                className={`vscode-branch-item ${isCur ? "current" : ""}`}
                                onClick={() => !isCur && handleSwitchBranch(b.name)}
                              >
                                <div className="vscode-branch-item-left">
                                  {isCur ? (
                                    <span className="current-check" title="当前活动分支">✓</span>
                                  ) : (
                                    <IconGitBranch size={13} className="branch-icon" />
                                  )}
                                  <span className="branch-name">{b.name}</span>
                                  {isCur && <span className="current-badge">HEAD</span>}
                                </div>
                                <div className="vscode-branch-item-right" onClick={(e) => e.stopPropagation()}>
                                  {b.hash && <span className="branch-hash">{b.hash}</span>}
                                  {!isCur && (
                                    <button
                                      className="branch-del-btn"
                                      title="删除本地分支"
                                      onClick={() => handleDeleteBranch(b.name, false)}
                                    >
                                      <IconTrash size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* Remote Branches Section */}
                    {(branchFilterTab === "all" || branchFilterTab === "remote") && (
                      <div className="vscode-branch-group">
                        <div className="vscode-branch-group-header">
                          <IconCloud size={12} />
                          <span>远程分支 ({filteredRemoteBranches.length})</span>
                        </div>
                        {filteredRemoteBranches.length === 0 ? (
                          <div className="vscode-branch-none">无匹配的远程分支</div>
                        ) : (
                          filteredRemoteBranches.map((b) => (
                            <div
                              key={`remote-${b.name}`}
                              className="vscode-branch-item remote"
                              onClick={() => handleSwitchBranch(b.name)}
                              title={`检出远程分支 ${b.name} 为本地跟踪分支`}
                            >
                              <div className="vscode-branch-item-left">
                                <IconCloud size={13} className="branch-icon remote" />
                                <span className="branch-name">{b.name}</span>
                                <span className="remote-checkout-hint">检出</span>
                              </div>
                              <div className="vscode-branch-item-right" onClick={(e) => e.stopPropagation()}>
                                {b.hash && <span className="branch-hash">{b.hash}</span>}
                                <button
                                  className="branch-del-btn"
                                  title="从远端删除此分支"
                                  onClick={() => handleDeleteBranch(b.name, true)}
                                >
                                  <IconTrash size={11} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TabMeta {
  id: string;
  title: string;
}

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket;
  container: HTMLDivElement;
}

/** 4. 嵌入式多标签终端 View */
function SideTerminalView({
  workspaceUri,
  projectName,
  onBack,
  onClose,
}: {
  workspaceUri?: string;
  projectName?: string;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const dockBodyRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  const [tabs, setTabs] = useState<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const counterRef = useRef(1);

  const createNewTab = useCallback(() => {
    if (!dockBodyRef.current) return;

    const baseTitle = projectName || "终端";
    const currentCount = counterRef.current;
    const tabTitle = currentCount === 1 ? baseTitle : `${baseTitle} ${currentCount}`;
    counterRef.current += 1;

    const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const container = document.createElement("div");
    container.className = "zcode-terminal-instance-container";
    container.id = `term-container-${tabId}`;
    dockBodyRef.current.appendChild(container);

    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0,
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", "JetBrains Mono", monospace',
      theme: isLight
        ? {
            background: "#ffffff",
            foreground: "#18181b",
            cursor: "#18181b",
            cursorAccent: "#ffffff",
            selectionBackground: "rgba(0, 0, 0, 0.15)",
            selectionForeground: "#000000",
            black: "#18181b",
            red: "#dc2626",
            green: "#16a34a",
            yellow: "#ca8a04",
            blue: "#2563eb",
            magenta: "#9333ea",
            cyan: "#0284c7",
            white: "#f8fafc",
            brightBlack: "#64748b",
            brightRed: "#ef4444",
            brightGreen: "#22c55e",
            brightYellow: "#eab308",
            brightBlue: "#3b82f6",
            brightMagenta: "#a855f7",
            brightCyan: "#06b6d4",
            brightWhite: "#0f172a",
          }
        : {
            background: "#161616",
            foreground: "#d4d4d8",
            cursor: "#ffffff",
            cursorAccent: "#161616",
            selectionBackground: "rgba(255, 255, 255, 0.22)",
            selectionForeground: "#ffffff",
            black: "#161616",
            red: "#f87171",
            green: "#4ade80",
            yellow: "#facc15",
            blue: "#60a5fa",
            magenta: "#c084fc",
            cyan: "#38bdf8",
            white: "#d4d4d8",
            brightBlack: "#71717a",
            brightRed: "#fca5a5",
            brightGreen: "#86efac",
            brightYellow: "#fef08a",
            brightBlue: "#93c5fd",
            brightMagenta: "#e9d5ff",
            brightCyan: "#7dd3fc",
            brightWhite: "#ffffff",
          },
      convertEol: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    try {
      fitAddon.fit();
    } catch {}

    const initialCols = term.cols || 80;
    const initialRows = term.rows || 25;
    const query = new URLSearchParams();
    if (workspaceUri) query.set("workspaceUri", workspaceUri);
    query.set("cols", String(initialCols));
    query.set("rows", String(initialRows));
    const wsUrl = `${resolveWsUrl("/api/terminal/ws")}?${query.toString()}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      term.focus();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" && typeof msg.data === "string") {
          term.write(msg.data);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[90m[终端连接已断开]\x1b[0m\r\n");
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[终端 WebSocket 连接失败]\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    instancesRef.current.set(tabId, { term, fitAddon, ws, container });

    setTabs((prev) => [...prev, { id: tabId, title: tabTitle }]);
    setActiveTabId(tabId);

    instancesRef.current.forEach((inst, id) => {
      inst.container.style.display = id === tabId ? "block" : "none";
    });

    setTimeout(() => {
      try {
        fitAddon.fit();
        term.focus();
      } catch {}
    }, 60);
  }, [projectName, workspaceUri]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    instancesRef.current.forEach((inst, id) => {
      inst.container.style.display = id === tabId ? "block" : "none";
    });
    const targetInst = instancesRef.current.get(tabId);
    if (targetInst) {
      setTimeout(() => {
        try {
          targetInst.fitAddon.fit();
          targetInst.term.focus();
        } catch {}
      }, 30);
    }
  }, []);

  const closeTab = useCallback(
    (e: React.MouseEvent, tabIdToClose: string) => {
      e.stopPropagation();

      const inst = instancesRef.current.get(tabIdToClose);
      if (inst) {
        try {
          inst.ws.close();
          inst.term.dispose();
          inst.container.remove();
        } catch {}
        instancesRef.current.delete(tabIdToClose);
      }

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabIdToClose);
        if (remaining.length === 0) {
          if (onBack) onBack();
          else if (onClose) onClose();
          counterRef.current = 1;
          return [];
        }

        if (activeTabId === tabIdToClose) {
          const nextActive = remaining[remaining.length - 1];
          setActiveTabId(nextActive.id);
          instancesRef.current.forEach((item, id) => {
            item.container.style.display = id === nextActive.id ? "block" : "none";
          });
          const nextInst = instancesRef.current.get(nextActive.id);
          if (nextInst) {
            setTimeout(() => {
              try {
                nextInst.fitAddon.fit();
                nextInst.term.focus();
              } catch {}
            }, 30);
          }
        }
        return remaining;
      });
    },
    [activeTabId, onBack, onClose],
  );

  useEffect(() => {
    if (instancesRef.current.size === 0) {
      const timer = setTimeout(() => {
        createNewTab();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [createNewTab]);

  useEffect(() => {
    const handleResize = () => {
      if (activeTabId) {
        const inst = instancesRef.current.get(activeTabId);
        try {
          inst?.fitAddon.fit();
        } catch {}
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTabId]);

  const shell = typeof navigator !== "undefined" && navigator.userAgent?.includes("Windows") ? "PowerShell" : "bash";

  return (
    <div className="zcode-side-terminal-wrap">
      <div className="zcode-panel-header">
        <div className="zcode-panel-header-left" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, overflow: "hidden" }}>
          <IconTerminalSquare size={14} style={{ color: "#10b981", flexShrink: 0 }} />
          <span className="zcode-panel-header-title" style={{ flexShrink: 0 }}>终端</span>
          <span className="zcode-terminal-shell-badge" style={{ flexShrink: 0 }}>{shell}</span>

          <div className="zcode-terminal-tab-list" style={{ display: "flex", alignItems: "center", gap: "4px", overflowX: "auto", scrollbarWidth: "none" }}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`zcode-terminal-tab ${isActive ? "active" : "inactive"}`}
                  onClick={() => switchTab(tab.id)}
                >
                  <span className="zcode-terminal-tab-name">{tab.title}</span>
                  <button
                    className="zcode-terminal-tab-close"
                    onClick={(e) => closeTab(e, tab.id)}
                    title="关闭此终端"
                    type="button"
                  >
                    <IconX size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="zcode-panel-header-actions" style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <button
            className="zcode-panel-tool-btn"
            onClick={createNewTab}
            title="新建终端"
            type="button"
          >
            <IconPlus size={14} />
          </button>
          {onBack && (
            <button className="zcode-panel-tool-btn" onClick={onBack} title="切换面板">
              <IconChevron size={12} style={{ transform: "rotate(90deg)" }} />
            </button>
          )}
          {onClose && (
            <button className="zcode-panel-tool-btn" onClick={onClose} title="关闭面板">
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      <div
        className="zcode-side-terminal-screen zcode-terminal-xterm-container"
        ref={dockBodyRef}
        onClick={() => {
          const inst = instancesRef.current.get(activeTabId);
          inst?.term.focus();
        }}
      />
    </div>
  );
}

/** Main SidePanel Component */
export function SidePanel({
  cascadeId,
  steps = [],
  messages = [],
  workspaceUri,
  projectName,
  selectedFile,
  activeSubagentId,
  onSelectSubagent,
  onClose,
  initialTab = null,
}: Props) {
  const [activeTab, setActiveTab] = useState<SidePanelTab | null>(() => initialTab);
  const [commitMsg, setCommitMsg] = useState("");
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);

  const { steps: liveSteps } = useStepsStream(cascadeId || "");
  const effectiveSteps = (steps && steps.length > 0) ? steps : liveSteps;
  const { subagents: subagentSessions, activeSubagent: hookActiveSubagent } = useSubagentViewer(effectiveSteps);

  const activeSubagent = useMemo(() => {
    if (!subagentSessions || subagentSessions.length === 0) return null;
    if (!activeSubagentId) return hookActiveSubagent || subagentSessions[0] || null;
    const target = activeSubagentId.toLowerCase();
    return (
      subagentSessions.find(
        (s) =>
          s.id === activeSubagentId ||
          s.role.toLowerCase() === target ||
          (s.conversationId && s.conversationId.toLowerCase() === target) ||
          s.id.toLowerCase().includes(target) ||
          target.includes(s.id.toLowerCase()) ||
          s.role.toLowerCase().includes(target) ||
          target.includes(s.role.toLowerCase())
      ) ||
      hookActiveSubagent ||
      subagentSessions[0] ||
      null
    );
  }, [subagentSessions, activeSubagentId, hookActiveSubagent]);

  useEffect(() => {
    if (initialTab !== undefined && initialTab !== null) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (activeSubagentId) {
      setActiveTab("subagent");
    }
  }, [activeSubagentId]);

  const prevFileRef = useRef(selectedFile);
  useEffect(() => {
    if (
      selectedFile &&
      (selectedFile.name !== prevFileRef.current?.name ||
        selectedFile.path !== prevFileRef.current?.path) &&
      (selectedFile.name || selectedFile.path)
    ) {
      setActiveTab("review");
    }
    prevFileRef.current = selectedFile;
  }, [selectedFile]);

  const handleOpenTab = (tab: SidePanelTab) => {
    triggerHaptic("medium");
    setActiveTab(tab);
  };

  const handleBackToPicker = () => {
    triggerHaptic("light");
    setActiveTab(null);
  };

  const handleApplyCommitToGit = (msg: string) => {
    setCommitMsg(msg);
    setActiveTab("git");
  };

  return (
    <div className="zcode-sidepanel-root">
      <div className="zcode-sidepanel-content">
        {activeTab === null ? (
          /* Empty State: Card Picker (Exact match of User's Reference Screenshot) */
          <div className="zcode-tab-picker-container">
            <div className="zcode-tab-picker-header">
              <h2 className="zcode-tab-picker-title">打开标签页</h2>
              <p className="zcode-tab-picker-subtitle">选择要在侧边面板中打开的标签。</p>
            </div>

            <div className="zcode-tab-picker-grid">
              {/* Card 1: 辅助对话 */}
              <div
                className="zcode-tab-picker-card"
                onClick={() => handleOpenTab("chat")}
                role="button"
                tabIndex={0}
              >
                <div className="zcode-picker-card-icon">
                  <IconMessageSquare size={20} />
                </div>
                <span className="zcode-picker-card-label">辅助对话</span>
              </div>

              {/* Card 2: 审查 */}
              <div
                className="zcode-tab-picker-card"
                onClick={() => handleOpenTab("review")}
                role="button"
                tabIndex={0}
              >
                <div className="zcode-picker-card-icon">
                  <IconFilePlus size={20} />
                </div>
                <span className="zcode-picker-card-label">审查</span>
              </div>

              {/* Card 3: 终端 */}
              <div
                className="zcode-tab-picker-card"
                onClick={() => handleOpenTab("terminal")}
                role="button"
                tabIndex={0}
              >
                <div className="zcode-picker-card-icon">
                  <IconTerminalSquare size={20} />
                </div>
                <span className="zcode-picker-card-label">终端</span>
              </div>

              {/* Card 4: 子智能体目录 (若有子智能体调用记录) */}
              {subagentSessions.length > 0 && (
                <div
                  className="zcode-tab-picker-card"
                  onClick={() => handleOpenTab("subagent_directory")}
                  role="button"
                  tabIndex={0}
                >
                  <div className="zcode-picker-card-icon" style={{ color: "#818cf8" }}>
                    <IconBot size={20} />
                  </div>
                  <span className="zcode-picker-card-label">
                    子智能体目录 ({subagentSessions.length})
                  </span>
                </div>
              )}
            </div>

            {onClose && (
              <button className="zcode-picker-close-btn" onClick={onClose} title="关闭面板">
                <IconX size={16} />
              </button>
            )}
          </div>
        ) : activeTab === "chat" ? (
          <SideChatView
            key={`side-chat-${cascadeId || "default"}`}
            cascadeId={cascadeId}
            steps={steps}
            workspaceUri={workspaceUri}
            onBack={handleBackToPicker}
            onClose={onClose}
            queuedPrompt={queuedPrompt}
            onClearQueuedPrompt={() => setQueuedPrompt(null)}
            onApplyCommitMsg={handleApplyCommitToGit}
          />
        ) : activeTab === "review" ? (
          <SideReviewView
            workspaceUri={workspaceUri}
            steps={steps}
            messages={messages}
            selectedFile={selectedFile}
            subagentSessions={subagentSessions}
            onSelectSubagent={(id) => {
              onSelectSubagent?.(id);
              setActiveTab("subagent");
            }}
            onOpenSubagentDirectory={() => setActiveTab("subagent_directory")}
            onBack={handleBackToPicker}
            onClose={onClose}
          />
        ) : activeTab === "git" ? (
          <SideGitView
            workspaceUri={workspaceUri}
            selectedFile={selectedFile}
            commitMsg={commitMsg}
            setCommitMsg={setCommitMsg}
            onBack={handleBackToPicker}
            onClose={onClose}
          />
        ) : activeTab === "terminal" ? (
          <SideTerminalView
            workspaceUri={workspaceUri}
            projectName={projectName}
            onBack={handleBackToPicker}
            onClose={onClose}
          />
        ) : activeTab === "subagent_directory" ? (
          <div className="zcode-side-subagent-dir-wrap" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="vscode-editor-tab-bar">
              <div className="vscode-editor-tabs-scroll">
                <div className="vscode-editor-tab active">
                  <IconBot size={13} style={{ color: "#818cf8" }} />
                  <span className="vscode-editor-tab-title">子智能体目录</span>
                  <button
                    className="vscode-editor-tab-close"
                    onClick={onClose}
                    title="关闭侧边栏"
                  >
                    <IconX size={11} />
                  </button>
                </div>
              </div>
            </div>
            <SubagentDirectoryView
              subagents={subagentSessions}
              onSelectSubagent={(id) => {
                onSelectSubagent?.(id);
                setActiveTab("subagent");
              }}
              onClose={onClose}
            />
          </div>
        ) : (
          /* activeTab === "subagent" */
          <div className="zcode-side-subagent-wrap" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {activeSubagent ? (
              <SubagentDetailViewer
                subagent={activeSubagent}
                allSubagents={subagentSessions}
                onSelectSubagent={(id) => {
                  onSelectSubagent?.(id);
                }}
                onOpenReview={() => {
                  setActiveTab("review");
                }}
                onClose={onClose || (() => {})}
              />
            ) : (
              <div className="zcode-empty-state" style={{ padding: "24px", textAlign: "center", color: "#a1a1aa" }}>
                <p style={{ marginBottom: "16px" }}>当前会话中未检测到子智能体执行记录</p>
                <button className="zcode-subagent-back-btn" onClick={onClose} style={{ margin: "0 auto" }}>
                  关闭侧边栏
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compatibility export */
export const ArtifactsConsole = SidePanel;
