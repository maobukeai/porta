import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconSearch, IconMessageSquare, IconFolder } from "./Icons";

export interface CommandPaletteAction {
  id: string;
  label: string;
  /** Right-aligned hint, e.g. "Ctrl+N" */
  hint?: string;
  /** Extra terms considered by the fuzzy matcher */
  keywords?: string;
  icon: ReactNode;
  run: () => void;
}

export interface CommandPaletteConversation {
  id: string;
  title: string;
  /** Workspace display name shown as the item hint */
  workspaceName?: string;
  lastModifiedTime?: string;
}

/** A previously-executed entry, resolved back against actions/conversations/workspaces */
export interface CommandPaletteRecent {
  kind: "action" | "conversation" | "workspace";
  id: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  conversations: CommandPaletteConversation[];
  workspaces: { uri: string; name: string }[];
  onSelectConversation: (id: string) => void;
  onSelectWorkspace: (uri: string) => void;
  /** Most-recently executed entries, pinned to the top when the query is empty */
  recents?: CommandPaletteRecent[];
  /** Fired before an item executes — use to record recents */
  onExecute?: (entry: CommandPaletteRecent) => void;
}

/** Simple case-insensitive subsequence match — good enough for a command palette */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

type PaletteItem =
  | { kind: "action"; action: CommandPaletteAction }
  | { kind: "workspace"; uri: string; name: string }
  | { kind: "conversation"; conv: CommandPaletteConversation };

const MAX_EMPTY_CONVERSATIONS = 6;

export function CommandPalette({
  open,
  onClose,
  actions,
  conversations,
  workspaces,
  onSelectConversation,
  onSelectWorkspace,
  recents,
  onExecute,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus after the portal mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();

    // Recently-used entries pinned at the top on the empty query; unresolvable
    // entries (e.g. deleted conversations) silently drop out.
    const recentItems: PaletteItem[] = [];
    const recentKeys = new Set<string>();
    if (!q && recents && recents.length > 0) {
      for (const r of recents) {
        const key = `${r.kind}:${r.id}`;
        if (recentKeys.has(key)) continue;
        if (r.kind === "action") {
          const a = actions.find((x) => x.id === r.id);
          if (a) {
            recentItems.push({ kind: "action", action: a });
            recentKeys.add(key);
          }
        } else if (r.kind === "conversation") {
          const c = conversations.find((x) => x.id === r.id);
          if (c) {
            recentItems.push({ kind: "conversation", conv: c });
            recentKeys.add(key);
          }
        } else if (r.kind === "workspace") {
          const w = workspaces.find((x) => x.uri === r.id);
          if (w) {
            recentItems.push({ kind: "workspace", uri: w.uri, name: w.name });
            recentKeys.add(key);
          }
        }
      }
    }

    const actionItems: PaletteItem[] = actions
      .filter((a) => {
        // On the empty query, actions already surfaced in the recents group are skipped
        if (!q && recentKeys.has(`action:${a.id}`)) return false;
        if (!q) return true;
        return fuzzyMatch(q, a.label) || fuzzyMatch(q, a.keywords ?? "");
      })
      .map((action) => ({ kind: "action" as const, action }));

    const workspaceItems: PaletteItem[] = workspaces
      .filter((w) => {
        if (!q && recentKeys.has(`workspace:${w.uri}`)) return false;
        return !q || fuzzyMatch(q, w.name) || fuzzyMatch(q, w.uri);
      })
      .slice(0, q ? 12 : 8)
      .map((w) => ({ kind: "workspace" as const, uri: w.uri, name: w.name }));

    const sortedConversations = q
      ? conversations
      : [...conversations]
          .sort(
            (a, b) =>
              new Date(b.lastModifiedTime ?? 0).getTime() -
              new Date(a.lastModifiedTime ?? 0).getTime(),
          );
    const conversationItems: PaletteItem[] = sortedConversations
      .filter((c) => {
        if (!q && recentKeys.has(`conversation:${c.id}`)) return false;
        return (
          !q ||
          fuzzyMatch(q, c.title) ||
          fuzzyMatch(q, c.id) ||
          fuzzyMatch(q, c.workspaceName ?? "")
        );
      })
      .slice(0, q ? 20 : MAX_EMPTY_CONVERSATIONS)
      .map((conv) => ({ kind: "conversation" as const, conv }));

    return [...recentItems, ...actionItems, ...workspaceItems, ...conversationItems];
  }, [query, actions, conversations, workspaces, recents]);

  // The recents group occupies the head of the flat item list (empty query only)
  const recentCount = useMemo(() => {
    const q = query.trim();
    if (q || !recents || recents.length === 0) return 0;
    const keys = new Set(recents.map((r) => `${r.kind}:${r.id}`));
    let count = 0;
    for (const item of items) {
      const key =
        item.kind === "action"
          ? `action:${item.action.id}`
          : item.kind === "workspace"
            ? `workspace:${item.uri}`
            : `conversation:${item.conv.id}`;
      if (keys.has(key)) count++;
      else break;
    }
    return count;
  }, [items, query, recents]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keep the selected item in view while navigating with the keyboard
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  const runItem = (item: PaletteItem) => {
    onExecute?.(
      item.kind === "action"
        ? { kind: "action", id: item.action.id }
        : item.kind === "workspace"
          ? { kind: "workspace", id: item.uri }
          : { kind: "conversation", id: item.conv.id },
    );
    onClose();
    if (item.kind === "action") item.action.run();
    else if (item.kind === "workspace") onSelectWorkspace(item.uri);
    else onSelectConversation(item.conv.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) =>
        items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) runItem(item);
    }
  };

  // Grouped rendering with flat selection indices
  let flatIndex = -1;
  let lastKind: PaletteItem["kind"] | "recent" | null = null;
  const groupLabels: Record<PaletteItem["kind"], string> = {
    action: "动作",
    workspace: "工作区",
    conversation: "会话",
  };

  return createPortal(
    <div className="command-palette-overlay" onMouseDown={onClose}>
      <div
        className="command-palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-input-row">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话、工作区或执行动作…"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="command-palette-esc" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="command-palette-results" ref={listRef}>
          {items.length === 0 && (
            <div className="command-palette-empty">没有匹配的结果</div>
          )}
          {items.map((item) => {
            flatIndex += 1;
            const idx = flatIndex;
            const group = idx < recentCount ? "recent" : item.kind;
            const showGroupLabel = group !== lastKind;
            lastKind = group;
            return (
              <div key={`${item.kind}-${idx}`}>
                {showGroupLabel && (
                  <div className="command-palette-group-label">
                    {group === "recent" ? "最近" : groupLabels[item.kind]}
                  </div>
                )}
                <button
                  type="button"
                  data-palette-index={idx}
                  className={`command-palette-item ${idx === selectedIndex ? "selected" : ""}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => runItem(item)}
                >
                  {item.kind === "action" && (
                    <>
                      {item.action.icon}
                      <span className="command-palette-item-label">
                        {item.action.label}
                      </span>
                      {item.action.hint && (
                        <span className="command-palette-item-hint">
                          {item.action.hint}
                        </span>
                      )}
                    </>
                  )}
                  {item.kind === "workspace" && (
                    <>
                      <IconFolder size={14} />
                      <span className="command-palette-item-label">{item.name}</span>
                      <span className="command-palette-item-hint">切换工作区</span>
                    </>
                  )}
                  {item.kind === "conversation" && (
                    <>
                      <IconMessageSquare size={14} />
                      <span className="command-palette-item-label">
                        {item.conv.title}
                      </span>
                      {item.conv.workspaceName && (
                        <span className="command-palette-item-hint">
                          {item.conv.workspaceName}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 确认
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
