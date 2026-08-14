import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ModelSelector } from "./ModelSelector";
import { api } from "../api/client";
import {
  IconPaperclip,
  IconPlus,
  IconMedia,
  IconAt,
  IconAction,
  IconGlobe,
  IconMessageCircle,
  IconChat,
  IconZap,
  IconEdit,
  IconUsers,
  IconFileText,
  IconFile,
  IconFolder,
  IconMic,
  IconMicOff,
  IconStop,
  IconSparkles,
} from "./Icons";
import { QuickCommandSheet } from "./QuickCommandSheet";
import type { MediaAttachment } from "../types";
import { prepareAttachments } from "../utils/imageAttachments";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { DEFAULT_MODEL } from "../constants";
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
  "image/webp",
];

export type PlannerType = "conversational" | "planning";

interface Props {
  onSend: (
    text: string,
    model: string | null,
    media?: MediaAttachment[],
    plannerType?: PlannerType,
  ) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  /** Default model from client settings; used as initial selection. */
  defaultModel?: string | null;
  /** Default planner type from client settings. */
  defaultPlannerType?: PlannerType;
}

interface AttachmentPreview {
  file: File;
  dataUrl: string;
}

interface SlashCommand {
  name: string;
  desc: string;
  category?: string;
}

interface MentionOption {
  name: string;
  desc: string;
  category: "rules" | "conversation" | "files" | "workspaces";
}

const MENTION_OPTIONS: MentionOption[] = [
  { name: "Rules", desc: "引用编码规范与自定义规则", category: "rules" },
  { name: "Conversation", desc: "引用历史对话上下文", category: "conversation" },
  { name: "Files", desc: "引用工作区中的文件", category: "files" },
  { name: "Workspaces", desc: "引用当前打开的工作区", category: "workspaces" },
];

const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { name: "btw", desc: "不中断主对话的情况下快速提问" },
  { name: "mcp:blender-mcp:asset_creation_strategy", desc: "定义在 Blender 中创建资产的策略" },
  { name: "goal", desc: "持续运行直至完全完成指定的开发目标" },
  { name: "schedule", desc: "按周期定时计划或一次性定时器运行指令" },
  { name: "browser", desc: "调用浏览器 Agent 执行网页任务" },
  { name: "grill-me", desc: "通过交互对话对齐并确认实施计划" },
  { name: "teamwork-preview", desc: "调用多智能体团队协同解决大型项目" },
  { name: "learn", desc: "总结复盘近期经验并沉淀为可复用技能" },
];

const PLANNER_OPTIONS: { value: PlannerType; label: string; desc: string }[] = [
  {
    value: "conversational",
    label: "快速",
    desc: "直接、单步响应",
  },
  { value: "planning", label: "规划", desc: "多步结构化方法" },
];

function AddContextSelector({
  onSelectMedia,
  onSelectMention,
  onSelectAction,
  onSelectBrowser,
  disabled,
}: {
  onSelectMedia: () => void;
  onSelectMention: () => void;
  onSelectAction: () => void;
  onSelectBrowser: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="add-context-selector" ref={ref}>
      <button
        className="chat-action-icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="添加上下文"
        disabled={disabled}
      >
        <IconPlus size={18} />
      </button>
      {open && (
        <div className="add-context-dropdown">
          <div className="add-context-header">添加上下文</div>
          <button
            className="add-context-item"
            onClick={() => {
              onSelectMedia();
              setOpen(false);
            }}
          >
            <IconMedia size={16} />
            <span>媒体</span>
          </button>
          <button
            className="add-context-item"
            onClick={() => {
              onSelectMention();
              setOpen(false);
            }}
          >
            <IconAt size={16} />
            <span>提及 (@)</span>
          </button>
          <button
            className="add-context-item"
            onClick={() => {
              onSelectAction();
              setOpen(false);
            }}
          >
            <IconAction size={16} />
            <span>快捷指令 (/)</span>
          </button>
          <button
            className="add-context-item"
            onClick={() => {
              onSelectBrowser();
              setOpen(false);
            }}
          >
            <IconGlobe size={16} />
            <span>浏览器</span>
          </button>
        </div>
      )}
    </div>
  );
}

function PlannerTypeSelector({
  plannerType,
  onSelect,
}: {
  plannerType: PlannerType;
  onSelect: (v: PlannerType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel =
    PLANNER_OPTIONS.find((o) => o.value === plannerType)?.label ?? "快速";

  return (
    <div className="model-selector" ref={ref}>
      <button
        className="model-selector-btn"
        onClick={() => setOpen((v) => !v)}
        title="选择规划器模式"
      >
        <span className="model-selector-label">{activeLabel}</span>
        <span className="model-selector-caret">▾</span>
      </button>
      {open && (
        <div className="model-selector-dropdown">
          {PLANNER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`model-option ${plannerType === opt.value ? "active" : ""}`}
              onClick={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
            >
              <span className="model-option-label">{opt.label}</span>
              <span className="model-option-meta">{opt.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatInput({
  onSend,
  onStop,
  isRunning,
  disabled,
  draft,
  onDraftChange,
  defaultModel,
  defaultPlannerType,
}: Props) {
  const effectiveDefault = defaultModel ?? DEFAULT_MODEL;
  const [model, setModel] = useState<string | null>(effectiveDefault);

  // Sync model when settings change
  useEffect(() => {
    setModel(effectiveDefault);
  }, [effectiveDefault]);

  const effectivePlanner = defaultPlannerType ?? "conversational";
  const [plannerType, setPlannerType] = useState<PlannerType>(effectivePlanner);

  // Sync planner type when settings change
  useEffect(() => {
    setPlannerType(effectivePlanner);
  }, [effectivePlanner]);

  // Stable ref so onTranscript (called before setDomAndSync is declared) can always call the latest version
  const setDomAndSyncRef = useRef<((next: string, opts?: { showSlash?: boolean; showMention?: boolean; closeMention?: boolean; closeSlash?: boolean }) => void) | null>(null);

  const {
    isListening,
    isSupported: isSpeechSupported,
    toggleListening,
    error: speechError,
  } = useSpeechToText({
    onTranscript: (text) => {
      // Read current DOM value (not stale draft) and append
      const current = textareaRef.current?.value ?? "";
      const next = current ? `${current} ${text}` : text;
      setDomAndSyncRef.current?.(next);
    },
  });

  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(true);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [showMentionMenu, setShowMentionMenu] = useState(true);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<SlashCommand[]>(DEFAULT_SLASH_COMMANDS);

  // Fetch dynamic commands from API on mount
  useEffect(() => {
    api
      .commands()
      .then((res) => {
        if (res.commands && res.commands.length > 0) {
          setCommands(res.commands);
        }
      })
      .catch(() => {
        // Keep default commands fallback on network/API error
      });
  }, []);

  const fileErrorTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // hasLocalText drives the send button — updated by native DOM listener, never by React re-renders.
  const [hasLocalText, setHasLocalText] = useState(() => draft.trim().length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep a stable ref to onDraftChange so native listeners can always call the latest version
  // without being re-created (which would require non-[] deps and cause re-render loops).
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => { onDraftChangeRef.current = onDraftChange; });

  // Helper to read the current textarea DOM value
  const getDomValue = useCallback(() => textareaRef.current?.value ?? "", []);

  // ── Parse slash/mention query state (driven by DOM, not React draft) ──
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // ── Single native input listener, mounted once. NEVER re-created. ──
  // This is the ONLY place we read textarea input during typing.
  // We do NOT call onDraftChange here — that causes parent re-renders which fight Android IME.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Set initial DOM value from draft prop (pre-filled drafts, draft store)
    if (draft) {
      el.value = draft;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }

    const onInput = () => {
      const val = el.value;
      // 1. Auto-resize
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
      // 2. Enable/disable send button
      setHasLocalText(val.trim().length > 0);
      // 3. Slash / mention autocomplete menus
      const slashMatch = val.match(/(?:^|\s)\/([^\s]*)$/);
      setSlashQuery(slashMatch ? slashMatch[1] : null);
      const mentionMatch = val.match(/(?:^|\s)@([^\s]*)$/);
      setMentionQuery(mentionMatch ? mentionMatch[1] : null);
      // 4. Persist draft — throttled to avoid re-render storms on every keystroke
      // We use a microtask so the browser can paint first
      const snapshot = val;
      Promise.resolve().then(() => {
        if (el.value === snapshot) onDraftChangeRef.current(snapshot);
      });
    };

    const onBlur = () => {
      // On keyboard dismiss, commit whatever is in the DOM
      const val = el.value;
      setHasLocalText(val.trim().length > 0);
      onDraftChangeRef.current(val);
    };

    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — NEVER re-mount. Stable ref (onDraftChangeRef) used for callback.

  // ── External draft sync (preset insert, send clear, revert) ──
  // Only runs when parent explicitly changes draft to something different from what's in the DOM.
  const lastExternalDraft = useRef(draft);
  useEffect(() => {
    // Skip if this matches what we last wrote ourselves (avoids echo-clearing)
    if (draft === lastExternalDraft.current) return;
    lastExternalDraft.current = draft;
    const el = textareaRef.current;
    if (!el || el.value === draft) return;
    el.value = draft;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    setHasLocalText(draft.trim().length > 0);
  }, [draft]);

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(q));
  }, [slashQuery, commands]);

  const filteredMentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return MENTION_OPTIONS.filter((opt) => opt.name.toLowerCase().includes(q));
  }, [mentionQuery]);



  useEffect(() => {
    setSlashSelectedIndex(0);
    if (slashQuery !== null) setShowSlashMenu(true);
  }, [slashQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
    if (mentionQuery !== null) setShowMentionMenu(true);
  }, [mentionQuery]);

  const [quickCommandSheetOpen, setQuickCommandSheetOpen] = useState(false);

  // ── No controlled useEffect needed: textarea is now uncontrolled ──
  // The textarea DOM element is the source of truth while the user is typing.
  // We sync back to parent via onDraftChange only on input/blur events.

  const showFileError = useCallback((msg: string) => {
    setFileError(msg);
    if (fileErrorTimer.current) clearTimeout(fileErrorTimer.current);
    fileErrorTimer.current = setTimeout(() => setFileError(null), 4000);
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      for (const file of fileArray) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          showFileError(`不支持的文件类型: ${file.type || "未知"}`);
          continue;
        }
        const dataUrl = URL.createObjectURL(file);
        setAttachments((prev) => {
          if (prev.length >= 5) return prev; // max 5 attachments
          return [...prev, { file, dataUrl }];
        });
      }
    },
    [showFileError],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index].dataUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const setDomAndSync = useCallback(
    (next: string, opts?: { showSlash?: boolean; showMention?: boolean; closeMention?: boolean; closeSlash?: boolean }) => {
      const el = textareaRef.current;
      if (el) {
        el.value = next;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 200) + "px";
      }
      lastExternalDraft.current = next;
      setHasLocalText(next.trim().length > 0);
      const slashMatch = next.match(/(?:^|\s)\/([^\s]*)$/);
      setSlashQuery(slashMatch ? slashMatch[1] : null);
      const mentionMatch = next.match(/(?:^|\s)@([^\s]*)$/);
      setMentionQuery(mentionMatch ? mentionMatch[1] : null);
      if (opts?.showSlash) setShowSlashMenu(true);
      if (opts?.showMention) setShowMentionMenu(true);
      if (opts?.closeSlash) setShowSlashMenu(false);
      if (opts?.closeMention) setShowMentionMenu(false);
      onDraftChange(next);
    },
    [onDraftChange],
  );

  // Wire the ref so onTranscript can always call the latest setDomAndSync
  setDomAndSyncRef.current = setDomAndSync;

  const appendTextToInput = useCallback(
    (textToAppend: string) => {
      const current = textareaRef.current?.value ?? draft;
      const next = current ? `${current.trimEnd()} ${textToAppend}` : textToAppend;
      setDomAndSync(next, { showSlash: true, showMention: true });
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [draft, setDomAndSync],
  );

  const insertSlashCommand = useCallback(
    (cmdName: string) => {
      const current = textareaRef.current?.value ?? draft;
      const match = current.match(/^(.*(?:^|\s))\/[a-zA-Z0-9_:-]*$/);
      const next = match ? `${match[1]}/${cmdName} ` : `/${cmdName} `;
      setDomAndSync(next, { closeSlash: true });
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [draft, setDomAndSync],
  );

  const insertMention = useCallback(
    (mentionName: string) => {
      const current = textareaRef.current?.value ?? draft;
      const match = current.match(/^(.*(?:^|\s))@[^\s]*$/);
      const next = match ? `${match[1]}@${mentionName} ` : `@${mentionName} `;
      setDomAndSync(next, { closeMention: true });
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [draft, setDomAndSync],
  );

  const handleSubmit = useCallback(async () => {
    // Always read from DOM directly — never stale React state
    const trimmed = getDomValue().trim();
    if ((!trimmed && attachments.length === 0) || disabled || isPreparingAttachments) return;

    setIsPreparingAttachments(true);
    try {
      let media: MediaAttachment[] | undefined;
      if (attachments.length > 0) {
        const prepared = await prepareAttachments(attachments.map((a) => a.file));
        media = prepared.map((attachment) => ({
          mimeType: attachment.mimeType,
          inlineData: attachment.inlineData,
        }));
      }
      onSend(trimmed || " ", model, media, plannerType);
      // Immediately wipe DOM and state — do NOT wait for parent draft to change
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      lastExternalDraft.current = "";
      setHasLocalText(false);
      setSlashQuery(null);
      setMentionQuery(null);
      onDraftChange("");
      attachments.forEach((a) => URL.revokeObjectURL(a.dataUrl));
      setAttachments([]);
    } catch (err) {
      showFileError(err instanceof Error ? err.message : "处理附件失败");
    } finally {
      setIsPreparingAttachments(false);
    }
  }, [
    getDomValue,
    attachments,
    disabled,
    isPreparingAttachments,
    onSend,
    model,
    plannerType,
    onDraftChange,
    showFileError,
  ]);

  const inputDisabled = disabled || isPreparingAttachments;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      showMentionMenu &&
      mentionQuery !== null &&
      filteredMentionOptions.length > 0
    ) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev + 1) % filteredMentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIndex(
          (prev) => (prev - 1 + filteredMentionOptions.length) % filteredMentionOptions.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredMentionOptions[mentionSelectedIndex];
        if (selected) {
          insertMention(selected.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    if (
      showSlashMenu &&
      slashQuery !== null &&
      filteredSlashCommands.length > 0
    ) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex(
          (prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredSlashCommands[slashSelectedIndex];
        if (selected) {
          insertSlashCommand(selected.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      // On mobile, Enter inserts a newline — send via button only
      if (window.innerWidth <= 480 || inputDisabled) return;
      e.preventDefault();
      handleSubmit();
    }
  };

  // No React synthetic event handlers for input/blur/composition.
  // All of these are handled by the native listener in useEffect([]) above.

  // Paste handler for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(e.target.files);
        e.target.value = ""; // reset so same file can be selected again
      }
    },
    [addFiles],
  );

  const renderSlashIcon = (name: string) => {
    if (name.includes("browser")) return <IconGlobe size={14} />;
    if (name.includes("grill")) return <IconEdit size={14} />;
    if (name.includes("teamwork")) return <IconUsers size={14} />;
    if (name.includes("mcp")) return <IconChat size={14} />;
    if (name.includes("btw")) return <IconMessageCircle size={14} />;
    return <IconZap size={14} />;
  };

  const renderMentionIcon = (category: MentionOption["category"]) => {
    if (category === "rules") return <IconFileText size={14} />;
    if (category === "conversation") return <IconMessageCircle size={14} />;
    if (category === "files") return <IconFile size={14} />;
    return <IconFolder size={14} />;
  };

  return (
    <div
      className={`chat-input-area ${dragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* File error toast */}
      {fileError && (
        <div className="file-error-toast" role="alert">
          {fileError}
        </div>
      )}

      {/* Mention Autocomplete Menu */}
      {showMentionMenu && mentionQuery !== null && filteredMentionOptions.length > 0 && (
        <div className="slash-autocomplete-menu mention-autocomplete-menu">
          {filteredMentionOptions.map((opt, idx) => {
            const isSelected = idx === mentionSelectedIndex;
            return (
              <button
                key={opt.name}
                className={`slash-command-item ${isSelected ? "selected" : ""}`}
                onClick={() => insertMention(opt.name)}
                onMouseEnter={() => setMentionSelectedIndex(idx)}
              >
                <span className="slash-command-icon">
                  {renderMentionIcon(opt.category)}
                </span>
                <span className="slash-command-name">{opt.name}</span>
                <span className="slash-command-desc">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Slash Autocomplete Menu */}
      {showSlashMenu && slashQuery !== null && filteredSlashCommands.length > 0 && (
        <div className="slash-autocomplete-menu">
          {filteredSlashCommands.map((cmd, idx) => {
            const isSelected = idx === slashSelectedIndex;
            return (
              <button
                key={cmd.name}
                className={`slash-command-item ${isSelected ? "selected" : ""}`}
                onClick={() => insertSlashCommand(cmd.name)}
                onMouseEnter={() => setSlashSelectedIndex(idx)}
              >
                <span className="slash-command-icon">
                  {renderSlashIcon(cmd.name)}
                </span>
                <span className="slash-command-name">{cmd.name}</span>
                <span className="slash-command-desc">{cmd.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Attachment previews (top) */}
      {attachments.length > 0 && (
        <div className="attachment-previews">
          {attachments.map((a, i) => (
            <div key={a.dataUrl} className="attachment-thumb">
              <img src={a.dataUrl} alt="attachment" />
              <button
                className="attachment-remove"
                onClick={() => removeAttachment(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {(fileError || speechError) && (
        <div className="chat-input-alert-banner">
          <span>{fileError || speechError}</span>
        </div>
      )}

      <div
        className="chat-input-wrap"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "BUTTON" &&
            target.tagName !== "TEXTAREA" &&
            target.tagName !== "INPUT" &&
            target.closest("button") === null &&
            target.closest(".model-selector") === null &&
            target.closest(".add-context-selector") === null
          ) {
            textareaRef.current?.focus();
          }
        }}
      >
        <div className="chat-input-top">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="发送消息..."
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            disabled={inputDisabled}
          />
        </div>

        <div className="chat-input-bottom">
          <div className="chat-input-bottom-left">
            <AddContextSelector
              disabled={inputDisabled}
              onSelectMedia={() => fileInputRef.current?.click()}
              onSelectMention={() => appendTextToInput("@")}
              onSelectAction={() => appendTextToInput("/")}
              onSelectBrowser={() => appendTextToInput("/browser")}
            />
            <button
              className="chat-action-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="添加图片"
              disabled={inputDisabled}
            >
              <IconPaperclip size={18} />
            </button>

            <button
              className="chat-action-icon-btn"
              onClick={() => setQuickCommandSheetOpen(true)}
              title="快捷 Prompt 指令库"
              disabled={inputDisabled}
            >
              <IconSparkles size={18} />
            </button>

            {isSpeechSupported && (
              <button
                className={`chat-action-icon-btn mic-btn ${isListening ? "listening" : ""}`}
                onClick={toggleListening}
                title={
                  isListening ? "正在语音识别（点击停止）" : "语音转文字输入"
                }
                disabled={inputDisabled}
              >
                {isListening ? <IconMicOff size={18} /> : <IconMic size={18} />}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              multiple
              tabIndex={-1}
              aria-hidden="true"
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
                opacity: 0,
                pointerEvents: "none",
              }}
              onChange={handleFileSelect}
              disabled={inputDisabled}
            />
          </div>

          <div className="chat-input-bottom-right">
            <ModelSelector selectedModel={model} onSelect={setModel} />
            <PlannerTypeSelector
              plannerType={plannerType}
              onSelect={setPlannerType}
            />
            {isRunning && (
              <button
                className="chat-stop-btn"
                onClick={onStop}
                title="停止生成"
              >
                <IconStop size={13} />
              </button>
            )}
            <button
              className="chat-send-btn"
              onClick={handleSubmit}
              disabled={
                (!hasLocalText && attachments.length === 0) || inputDisabled
              }
              title={
                isPreparingAttachments ? "正在处理图片..." : "发送 (Enter)"
              }
            >
              ↑
            </button>
          </div>
        </div>
      </div>
      <QuickCommandSheet
        isOpen={quickCommandSheetOpen}
        onClose={() => setQuickCommandSheetOpen(false)}
        onSelectPreset={(preset) => {
          setDomAndSync(preset.prompt);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
      />
    </div>
  );
}
