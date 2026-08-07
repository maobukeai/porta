import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { ConversationEntry } from "../hooks/useConversations";
import {
  IconPlus,
  IconFolder,
  IconMessageCircle,
  IconX,
  IconChevronRight,
  IconSearch,
  IconGrid,
  IconLayers,
  IconClock,
  IconZap,
  IconExternalLink,
} from "./Icons";
import { triggerHaptic } from "../utils/haptics";

export interface WorkspaceItem {
  uri: string;
  name: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  conversations: ConversationEntry[];
  activeId: string | null;
  currentProjectSlug?: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onOpenSidebar: () => void;
  workspaces?: WorkspaceItem[];
  onSelectProject?: (slug: string) => void;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return "刚刚";
  const time = new Date(iso).getTime();
  if (isNaN(time)) return "未知时间";
  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  return `${Math.floor(days / 7)}周前`;
}

export function QuickSwitchSheet({
  isOpen,
  onClose,
  conversations,
  activeId,
  currentProjectSlug,
  onSelectChat,
  onNewChat,
  onOpenSidebar,
  workspaces = [],
  onSelectProject,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | "all">("all");
  const [isGridMode, setIsGridMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "current" | "active">("all");

  // Touch drag to dismiss
  const touchStartY = useRef(0);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);
  const isDragging = useRef(false);

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSheetTranslateY(0);
      isDragging.current = false;
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Touch gestures for pull down to dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const currentY = e.touches[0].clientY;
    const delta = currentY - touchStartY.current;
    if (delta > 0) {
      // Resistance dragging down
      setSheetTranslateY(Math.min(delta, 180));
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (sheetTranslateY > 65) {
      triggerHaptic("light");
      onClose();
    }
    setSheetTranslateY(0);
  };

  // Count conversations per workspace
  const workspaceCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const conv of conversations) {
      const pName = (conv.summary.projectName || "").toLowerCase();
      if (pName) {
        map.set(pName, (map.get(pName) || 0) + 1);
      }
    }
    return map;
  }, [conversations]);

  // Filtered list of conversations
  const filteredConversations = useMemo(() => {
    let list = conversations;

    // 1. Tab Filter
    if (activeTab === "current" && currentProjectSlug) {
      const slugLower = currentProjectSlug.toLowerCase();
      list = list.filter((c) =>
        (c.summary.projectName || "").toLowerCase().includes(slugLower)
      );
    } else if (activeTab === "active") {
      list = list.filter(
        (c) =>
          c.summary.status !== "CASCADE_RUN_STATUS_UNLOADED" &&
          (c.summary.status === "CASCADE_RUN_STATUS_RUNNING" ||
            c.id === activeId ||
            (c.summary.stepCount || 0) > 0)
      );
    }

    // 2. Workspace Filter (if selected specific workspace chip)
    if (selectedWorkspace !== "all") {
      const target = selectedWorkspace.toLowerCase();
      list = list.filter((c) =>
        (c.summary.projectName || "").toLowerCase().includes(target)
      );
    }

    // 3. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.summary.summary || "").toLowerCase().includes(q) ||
          (c.summary.projectName || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [conversations, activeTab, currentProjectSlug, selectedWorkspace, searchQuery, activeId]);

  // Filtered workspaces for search
  const filteredWorkspaces = useMemo(() => {
    if (!searchQuery.trim()) return workspaces;
    const q = searchQuery.trim().toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(q));
  }, [workspaces, searchQuery]);

  // Highlight helper for search
  const highlightMatch = useCallback(
    (text: string, query: string) => {
      if (!query.trim() || !text) return text;
      const q = query.trim();
      const index = text.toLowerCase().indexOf(q.toLowerCase());
      if (index === -1) return text;
      const before = text.slice(0, index);
      const match = text.slice(index, index + q.length);
      const after = text.slice(index + q.length);
      return (
        <>
          {before}
          <mark className="quick-highlight">{match}</mark>
          {after}
        </>
      );
    },
    []
  );

  if (!isOpen) return null;

  return (
    <div className="quick-switch-overlay" onClick={onClose}>
      <div
        className="quick-switch-sheet"
        ref={sheetRef}
        style={{
          transform: sheetTranslateY > 0 ? `translateY(${sheetTranslateY}px)` : undefined,
          transition: isDragging.current ? "none" : "transform 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Swipe Handle Bar */}
        <div
          className="quick-switch-handle-bar"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="quick-switch-handle" />
        </div>

        {/* Top Header */}
        <div className="quick-switch-header">
          <div className="quick-switch-title-wrap">
            <span className="quick-switch-title">快速切换</span>
            <span className="quick-switch-badge-count">
              {conversations.length} 对话 · {workspaces.length} 工作区
            </span>
          </div>
          <button
            className="quick-switch-close-btn"
            onClick={() => {
              triggerHaptic("light");
              onClose();
            }}
            aria-label="关闭"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="quick-switch-search-wrap">
          <IconSearch size={15} className="quick-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="quick-search-input"
            placeholder="快速搜索对话标题或工作区..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="quick-search-clear"
              onClick={() => {
                triggerHaptic("light");
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              aria-label="清除搜索"
            >
              <IconX size={13} />
            </button>
          )}
        </div>

        {/* Action Buttons */}
        <div className="quick-switch-actions">
          <button
            className="quick-action-btn primary"
            onClick={() => {
              triggerHaptic("medium");
              onNewChat();
              onClose();
            }}
          >
            <IconPlus size={16} />
            <span>新建对话</span>
          </button>
          <button
            className="quick-action-btn secondary"
            onClick={() => {
              triggerHaptic("light");
              onClose();
              onOpenSidebar();
            }}
          >
            <IconFolder size={16} />
            <span>全部工作区 & 历史</span>
          </button>
        </div>

        {/* Workspaces Section */}
        {workspaces.length > 0 && (
          <div className="quick-switch-section">
            <div className="quick-switch-section-header">
              <div className="quick-switch-section-label">
                <span>工作区</span>
                {selectedWorkspace !== "all" && (
                  <span className="quick-section-filtered-hint">
                    (已过滤: {selectedWorkspace})
                  </span>
                )}
              </div>
              <div className="quick-workspace-actions-right">
                {selectedWorkspace !== "all" && (
                  <button
                    className="quick-text-btn"
                    onClick={() => {
                      triggerHaptic("light");
                      setSelectedWorkspace("all");
                    }}
                  >
                    清除过滤
                  </button>
                )}
                <button
                  className="quick-mode-toggle-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    setIsGridMode((prev) => !prev);
                  }}
                  title={isGridMode ? "切换到单行横滑" : "展开全部工作区平铺"}
                >
                  {isGridMode ? <IconLayers size={13} /> : <IconGrid size={13} />}
                  <span>{isGridMode ? "收起" : "展开全部"}</span>
                </button>
              </div>
            </div>

            <div
              className={`quick-switch-workspaces-container ${
                isGridMode ? "grid-mode" : "scroll-mode"
              }`}
            >
              {/* All Workspace Chip */}
              <button
                className={`quick-workspace-chip ${
                  selectedWorkspace === "all" ? "active" : ""
                }`}
                onClick={() => {
                  triggerHaptic("light");
                  setSelectedWorkspace("all");
                }}
              >
                <IconZap size={12} />
                <span>全部</span>
                <span className="quick-ws-badge">{conversations.length}</span>
              </button>

              {/* Individual Workspace Chips */}
              {filteredWorkspaces.map((ws) => {
                const name = ws.name;
                const isSelected = selectedWorkspace === name;
                const isCurrentProject =
                  currentProjectSlug &&
                  name.toLowerCase().includes(currentProjectSlug.toLowerCase());
                const count = workspaceCountMap.get(name.toLowerCase()) || 0;

                return (
                  <div
                    key={ws.uri}
                    className={`quick-workspace-chip-wrap ${isSelected ? "selected" : ""} ${
                      isCurrentProject ? "is-current" : ""
                    }`}
                  >
                    <button
                      className={`quick-workspace-chip ${isSelected ? "active" : ""}`}
                      onClick={() => {
                        triggerHaptic("light");
                        setSelectedWorkspace((prev) => (prev === name ? "all" : name));
                      }}
                      title="点击过滤该工作区下的对话"
                    >
                      <IconFolder size={12} />
                      <span className="quick-ws-name">
                        {highlightMatch(name, searchQuery)}
                      </span>
                      {count > 0 && <span className="quick-ws-badge">{count}</span>}
                    </button>

                    {/* Direct jump to workspace page icon button */}
                    {onSelectProject && (
                      <button
                        className="quick-ws-jump-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerHaptic("medium");
                          onSelectProject(name);
                          onClose();
                        }}
                        title={`进入 ${name} 工作区`}
                      >
                        <IconExternalLink size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Conversations List Section */}
        <div className="quick-switch-section flex-1">
          <div className="quick-switch-section-header">
            <div className="quick-switch-section-label">
              <span>近期对话</span>
              <span className="quick-conv-count-badge">
                {filteredConversations.length}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="quick-tabs-wrap">
              <button
                className={`quick-tab-item ${activeTab === "all" ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic("light");
                  setActiveTab("all");
                }}
              >
                全部
              </button>
              {currentProjectSlug && (
                <button
                  className={`quick-tab-item ${activeTab === "current" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    setActiveTab("current");
                  }}
                >
                  当前项目
                </button>
              )}
              <button
                className={`quick-tab-item ${activeTab === "active" ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic("light");
                  setActiveTab("active");
                }}
              >
                活跃
              </button>
            </div>
          </div>

          <div className="quick-switch-conversations-list">
            {filteredConversations.map((conv) => {
              const isCurrent = conv.id === activeId;
              const isRunning = conv.summary.status === "CASCADE_RUN_STATUS_RUNNING";
              const timeStr = formatRelativeTime(
                conv.summary.lastModifiedTime || conv.summary.createdTime
              );

              return (
                <button
                  key={conv.id}
                  className={`quick-conversation-item ${isCurrent ? "active" : ""} ${
                    isRunning ? "running" : ""
                  }`}
                  onClick={() => {
                    triggerHaptic("light");
                    onSelectChat(conv.id);
                    onClose();
                  }}
                >
                  <div className="quick-conv-left">
                    <div className="quick-conv-icon-wrap">
                      <IconMessageCircle
                        size={15}
                        className={isCurrent ? "active-icon" : "dim-icon"}
                      />
                      {isRunning && <span className="quick-status-pulse" />}
                    </div>

                    <div className="quick-conv-info">
                      <div className="quick-conv-title-row">
                        <span className="quick-conv-title">
                          {highlightMatch(
                            conv.summary.summary || "新对话",
                            searchQuery
                          )}
                        </span>
                        {isCurrent && (
                          <span className="quick-current-tag">当前</span>
                        )}
                      </div>

                      <div className="quick-conv-meta">
                        {conv.summary.projectName && (
                          <span className="quick-conv-project-badge">
                            {highlightMatch(conv.summary.projectName, searchQuery)}
                          </span>
                        )}
                        <span className="quick-conv-step">
                          {conv.summary.stepCount || 0} 步
                        </span>
                        <span className="quick-conv-time">
                          <IconClock size={10} />
                          {timeStr}
                        </span>
                      </div>
                    </div>
                  </div>

                  <IconChevronRight size={14} className="quick-conv-arrow" />
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="quick-switch-empty-card">
                <div className="quick-empty-icon">
                  <IconSearch size={22} />
                </div>
                <div className="quick-empty-title">
                  {searchQuery ? "未找到匹配的对话" : "暂无对话记录"}
                </div>
                <div className="quick-empty-desc">
                  {searchQuery
                    ? "尝试更换关键词或清除工作区过滤"
                    : "点击上方「新建对话」立即开启全新会话"}
                </div>
                {searchQuery && (
                  <button
                    className="quick-empty-action-btn"
                    onClick={() => {
                      triggerHaptic("light");
                      setSearchQuery("");
                      setSelectedWorkspace("all");
                    }}
                  >
                    重置所有筛选
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
