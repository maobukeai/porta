import { useState, useEffect, useRef, useMemo } from "react";
import { IconFolder, IconCheck, IconSearch, IconX } from "./Icons";

interface Props {
  workspaces: { uri: string; name: string }[];
  selected: string;
  onSelect: (uri: string) => void;
}

export function WorkspaceSelector({ workspaces, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus search input on open & scroll active item into view
  useEffect(() => {
    if (open) {
      setSearch("");
      if (workspaces.length >= 5) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      setTimeout(() => {
        const activeEl = listRef.current?.querySelector(".workspace-option.active");
        activeEl?.scrollIntoView({ block: "nearest" });
      }, 50);
    }
  }, [open, workspaces.length]);

  // Close on outside click or Esc
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const activeLabel =
    workspaces.find((w) => w.uri === selected)?.name ?? (selected ? "项目" : "任务 (无项目)");

  // Filter workspaces based on search query
  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.uri.toLowerCase().includes(q),
    );
  }, [workspaces, search]);

  const showSearch = workspaces.length >= 5;

  return (
    <div className="workspace-selector-container" ref={ref}>
      <button
        type="button"
        className={`workspace-selector-btn ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="选择工作区"
      >
        <span className="workspace-selector-label">
          <IconFolder size={13} className="workspace-selector-icon" />
          <span>{activeLabel}</span>
        </span>
        <span className={`workspace-selector-caret ${open ? "is-open" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="workspace-selector-dropdown">
          <div className="workspace-selector-dropdown-header">
            <div className="workspace-selector-dropdown-title">
              <span>选择工作区</span>
              <span className="workspace-count-badge">
                {search ? `${filteredWorkspaces.length}/${workspaces.length}` : `${workspaces.length} 个`}
              </span>
            </div>
            {showSearch && (
              <div className="workspace-search-box">
                <IconSearch size={12} className="workspace-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="workspace-search-input"
                  placeholder="搜索目录或项目..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filteredWorkspaces.length > 0) {
                      onSelect(filteredWorkspaces[0].uri);
                      setOpen(false);
                    }
                  }}
                />
                {search && (
                  <button
                    type="button"
                    className="workspace-search-clear"
                    onClick={() => setSearch("")}
                    title="清空"
                  >
                    <IconX size={11} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="workspace-selector-list" ref={listRef}>
            {filteredWorkspaces.length > 0 ? (
              filteredWorkspaces.map((ws) => {
                const isActive = ws.uri === selected;
                return (
                  <button
                    type="button"
                    key={ws.uri}
                    className={`workspace-option ${isActive ? "active" : ""}`}
                    onClick={() => {
                      onSelect(ws.uri);
                      setOpen(false);
                    }}
                    title={ws.name}
                  >
                    <IconFolder size={14} className="workspace-option-icon" />
                    <span className="workspace-option-label">{ws.name}</span>
                    {isActive && <IconCheck size={13} className="workspace-option-check" />}
                  </button>
                );
              })
            ) : (
              <div className="workspace-empty-search">
                <span>无匹配工作区</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
