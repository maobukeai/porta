import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { IconSearch, IconChevronUp, IconChevronDown, IconX } from "./Icons";
import type { ChatMessage } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Full visible message list (server + optimistic) from ChatPanel state */
  messages: ChatMessage[];
  /** The .chat-area scroll container — anchors live inside it */
  scrollRef: RefObject<HTMLDivElement | null>;
}

interface SearchHit {
  /** DOM anchor selector value */
  stepIndex?: number;
  optimisticId?: string;
  role: string;
  snippet: string;
}

const SNIPPET_RADIUS = 28;
const FLASH_MS = 1600;

function buildSnippet(content: string, matchPos: number, query: string): string {
  const start = Math.max(0, matchPos - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchPos + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ")}${suffix}`;
}

/**
 * VS Code-style in-conversation find bar (Ctrl+F).
 * Non-modal: floats over the chat area, Enter/F3 cycle matches,
 * the target message scrolls into view and flashes.
 */
export function ChatSearchOverlay({ open, onClose, messages, scrollRef }: Props) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlashedRef = useRef<HTMLElement | null>(null);

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchHit[] = [];
    for (const msg of messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      if (!msg.content) continue;
      const pos = msg.content.toLowerCase().indexOf(q);
      if (pos === -1) continue;
      out.push({
        stepIndex: typeof msg.stepIndex === "number" && msg.stepIndex >= 0 ? msg.stepIndex : undefined,
        optimisticId: msg.optimisticId,
        role: msg.role,
        snippet: buildSnippet(msg.content, pos, q),
      });
    }
    return out;
  }, [query, messages]);

  useEffect(() => {
    if (open) {
      // Re-focus the input when re-opened, keep the previous query for refinement
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clear the flash class when unmounting or moving on
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      lastFlashedRef.current?.classList.remove("search-flash");
    };
  }, []);

  const flashTarget = (el: HTMLElement) => {
    if (lastFlashedRef.current && lastFlashedRef.current !== el) {
      lastFlashedRef.current.classList.remove("search-flash");
    }
    el.classList.remove("search-flash");
    // Restart the CSS animation
    void el.offsetWidth;
    el.classList.add("search-flash");
    lastFlashedRef.current = el;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      el.classList.remove("search-flash");
    }, FLASH_MS);
  };

  const goTo = (index: number) => {
    if (hits.length === 0) return;
    const clamped = ((index % hits.length) + hits.length) % hits.length;
    setMatchIndex(clamped);
    const hit = hits[clamped];
    const root = scrollRef.current ?? document;
    let el: HTMLElement | null = null;
    if (hit.stepIndex !== undefined) {
      el = root.querySelector<HTMLElement>(`[data-step-index="${hit.stepIndex}"]`);
    }
    if (!el && hit.optimisticId) {
      el = root.querySelector<HTMLElement>(`[data-optimistic-id="${CSS.escape(hit.optimisticId)}"]`);
    }
    if (el) {
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
      flashTarget(el);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goTo(e.shiftKey ? matchIndex - 1 : matchIndex + 1);
    } else if (e.key === "F3") {
      e.preventDefault();
      goTo(e.shiftKey ? matchIndex - 1 : matchIndex + 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Jump to the first fresh match as the query changes (effect runs after hits recompute)
  useEffect(() => {
    setMatchIndex(0);
    if (query.trim()) {
      goTo(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!open) return null;

  return (
    <div className="chat-search-bar" onKeyDown={handleKeyDown}>
      <IconSearch size={14} className="chat-search-icon" />
      <input
        ref={inputRef}
        className="chat-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="在对话中查找…"
        spellCheck={false}
        autoComplete="off"
      />
      {query.trim() && (
        <span className="chat-search-count">
          {hits.length > 0 ? `${matchIndex + 1}/${hits.length}` : "0/0"}
        </span>
      )}
      <button
        type="button"
        className="chat-search-nav-btn"
        onClick={() => goTo(matchIndex - 1)}
        disabled={hits.length === 0}
        title="上一个匹配 (Shift+Enter)"
        aria-label="上一个匹配"
      >
        <IconChevronUp size={13} />
      </button>
      <button
        type="button"
        className="chat-search-nav-btn"
        onClick={() => goTo(matchIndex + 1)}
        disabled={hits.length === 0}
        title="下一个匹配 (Enter)"
        aria-label="下一个匹配"
      >
        <IconChevronDown size={13} />
      </button>
      <button
        type="button"
        className="chat-search-nav-btn"
        onClick={onClose}
        title="关闭 (Esc)"
        aria-label="关闭搜索"
      >
        <IconX size={13} />
      </button>
    </div>
  );
}
