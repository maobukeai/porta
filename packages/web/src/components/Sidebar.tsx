import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { ConversationEntry } from "../hooks/useConversations";
import { api } from "../api/client";
import { workspaceNameFromMetadata, workspaceNameFromUri } from "../utils/workspaceNames";
import { prefetchSteps } from "../hooks/useStepsStream";
import { usePolling } from "../hooks/usePolling";
import { AccountQuotaModal } from "./AccountQuotaModal";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  IconMCode,
  IconPlus,
  IconPlusCircle,
  IconSearch,
  IconMenu,
  IconX,
  IconSpinner,
  IconGear,
  IconPencil,
  IconTrash,
  IconArchive,
  IconSparkles,
  IconFilter,
  IconFolder,
  IconFolderOpen,
  IconChevron,
  IconCollapseAll,
  IconExpandAll,
  IconMessagePlus,
  IconMessageCheck,
  IconClock,
  IconCheck,
  IconPin,
  IconHelpCircle,
  IconPlay,
  IconEye,
} from "./Icons";
import { loadWaitingTasks } from "../utils/waitingTasks";
import { isSubagentConversation } from "../utils/subagents";

interface Props {
  conversations: ConversationEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: (workspaceUri?: string | null) => void;
  onDelete: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onSettings: () => void;
  loading: boolean;
  connected: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

interface WorkspaceGroup {
  name: string;
  workspaceUri?: string;
  conversations: ConversationEntry[];
  hasWaiting?: boolean;
  hasRunning: boolean;
  hasUnread: boolean;
}

function relativeTimeCompact(iso?: string): string {
  if (!iso) return "刚刚";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "刚刚";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  return `${Math.floor(days / 30)}月`;
}

export function isTaskGroupName(name?: string): boolean {
  if (!name) return true;
  return name === "任务" || name === "其他" || name === "Others";
}

function extractWorkspaceName(conv: ConversationEntry): string {
  if (conv.summary.projectName) {
    if (isTaskGroupName(conv.summary.projectName)) {
      return "任务";
    }
    return conv.summary.projectName;
  }
  const ws = conv.summary.workspaces?.[0];
  if (ws?.workspaceFolderAbsoluteUri) {
    return workspaceNameFromUri(ws.workspaceFolderAbsoluteUri);
  }
  const name = workspaceNameFromMetadata(ws, {
    collapseAntigravityPlayground: true,
  });
  return isTaskGroupName(name) ? "任务" : name;
}

function isArchived(conv: ConversationEntry): boolean {
  return conv.summary.status === "CASCADE_RUN_STATUS_UNLOADED";
}

const UNREAD_TASKS_KEY = "porta_unread_completed_tasks_v1";

function loadUnreadTasks(): Set<string> {
  try {
    const raw = localStorage.getItem(UNREAD_TASKS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadTasks(set: Set<string>) {
  try {
    localStorage.setItem(UNREAD_TASKS_KEY, JSON.stringify([...set]));
  } catch {}
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onToggleArchive,
  onSettings,
  loading,
  connected: _connected,
  isOpen,
  onToggle,
}: Props) {
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => loadUnreadTasks());
  const [waitingIds, setWaitingIds] = useState<Set<string>>(() => loadWaitingTasks());
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const conversationContextMenu = useContextMenu();

  // Listen for waiting task updates across conversations
  useEffect(() => {
    const handleWaitingTasksUpdate = () => {
      setWaitingIds(loadWaitingTasks());
    };
    window.addEventListener("porta:waiting-tasks-updated", handleWaitingTasksUpdate);
    window.addEventListener("storage", handleWaitingTasksUpdate);
    return () => {
      window.removeEventListener("porta:waiting-tasks-updated", handleWaitingTasksUpdate);
      window.removeEventListener("storage", handleWaitingTasksUpdate);
    };
  }, []);

  // Background prefetch for running conversations to immediately detect waiting choices
  useEffect(() => {
    const runningConvs = conversations.filter(
      (c) => c.summary.status === "CASCADE_RUN_STATUS_RUNNING",
    );
    if (runningConvs.length === 0) return;

    const doPrefetch = () => {
      runningConvs.forEach((c) => {
        prefetchSteps(c.id);
      });
    };

    doPrefetch();
    const timer = setInterval(doPrefetch, 1500);
    return () => clearInterval(timer);
  }, [conversations]);

  // Mark current conversation as read whenever activeId changes
  useEffect(() => {
    if (!activeId) return;
    setUnreadIds((prev) => {
      if (!prev.has(activeId)) return prev;
      const next = new Set(prev);
      next.delete(activeId);
      saveUnreadTasks(next);
      return next;
    });
  }, [activeId]);

  // Track task completions in background
  useEffect(() => {
    const prevMap = prevStatusesRef.current;

    for (const conv of conversations) {
      const prevStatus = prevMap.get(conv.id);
      const currentStatus = conv.summary.status;
      if (
        prevStatus === "CASCADE_RUN_STATUS_RUNNING" &&
        currentStatus !== "CASCADE_RUN_STATUS_RUNNING" &&
        conv.id !== activeId
      ) {
        setUnreadIds((prev) => {
          const next = new Set(prev);
          next.add(conv.id);
          saveUnreadTasks(next);
          return next;
        });
      }
      prevMap.set(conv.id, currentStatus);
    }
  }, [conversations, activeId]);

  const [viewMode, setViewMode] = useState<"project" | "timeline">(() => {
    try {
      const saved = localStorage.getItem("porta:sidebarViewMode");
      if (saved === "project" || saved === "timeline") return saved;
    } catch {}
    return "project";
  });

  const [sortBy, setSortBy] = useState<"updated" | "created">(() => {
    try {
      const saved = localStorage.getItem("porta:sidebarSortBy");
      if (saved === "updated" || saved === "created") return saved;
    } catch {}
    return "updated";
  });

  // Status quick-filters (只看运行中 / 只看未读), combinable with the text filter
  const [statusFilter, setStatusFilter] = useState<{ running: boolean; unread: boolean }>(() => {
    try {
      const raw = localStorage.getItem("porta:sidebarStatusFilter");
      if (raw) {
        const parsed = JSON.parse(raw);
        return { running: parsed?.running === true, unread: parsed?.unread === true };
      }
    } catch {}
    return { running: false, unread: false };
  });

  const toggleStatusFilter = useCallback((key: "running" | "unread") => {
    setStatusFilter((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("porta:sidebarStatusFilter", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const [viewSortMenuOpen, setViewSortMenuOpen] = useState(false);
  const viewSortMenuRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // Close view/sort popover on outside click
  useEffect(() => {
    if (!viewSortMenuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e instanceof TouchEvent ? e.touches[0]?.target : e.target;
      if (
        viewSortMenuRef.current &&
        target &&
        !viewSortMenuRef.current.contains(target as Node) &&
        filterBtnRef.current &&
        !filterBtnRef.current.contains(target as Node)
      ) {
        setViewSortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler as EventListener);
    document.addEventListener("touchstart", handler as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler as EventListener);
      document.removeEventListener("touchstart", handler as EventListener);
    };
  }, [viewSortMenuOpen]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("porta:sidebarGroupCollapsed_v1");
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const [customGroupOrder, setCustomGroupOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("porta:sidebarGroupOrder_v1");
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });
  const [draggedGroupName, setDraggedGroupName] = useState<string | null>(null);
  const [dragOverGroupName, setDragOverGroupName] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<"top" | "bottom" | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    | {
        id: string;
        title: string;
        snippets: string[];
        matchCount: number;
      }[]
    | null
  >(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Listen for global custom event to open Quota Popover from chat cards or other components
  useEffect(() => {
    const handleOpenQuota = () => setQuotaOpen(true);
    window.addEventListener("antigravity:open-quota", handleOpenQuota);
    return () => window.removeEventListener("antigravity:open-quota", handleOpenQuota);
  }, []);

  // ── Horizontal Drag-to-Resize Sidebar Width ──
  const DEFAULT_WIDTH = 250;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = Math.min(600, typeof window !== "undefined" ? window.innerWidth * 0.75 : 500);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("porta:sidebarWidth");
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= MIN_WIDTH && val <= 800) {
          return val;
        }
      }
    } catch {}
    return DEFAULT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = sidebarWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startXRef.current;
        const newWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, Math.round(startWidthRef.current + deltaX)),
        );
        setSidebarWidth(newWidth);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        setIsResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);

        const finalDeltaX = upEvent.clientX - startXRef.current;
        const finalWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, Math.round(startWidthRef.current + finalDeltaX)),
        );
        try {
          localStorage.setItem("porta:sidebarWidth", finalWidth.toString());
        } catch {}
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [sidebarWidth, MAX_WIDTH],
  );

  const handleDoubleClickReset = useCallback(() => {
    setSidebarWidth(DEFAULT_WIDTH);
    try {
      localStorage.setItem("porta:sidebarWidth", DEFAULT_WIDTH.toString());
    } catch {}
  }, []);

  // Dynamic live client account status from Language Server
  const { data: userStatusData } = usePolling(api.userStatus, 15_000);
  const userStatus = userStatusData?.userStatus;

  // Real client account name (dynamic when client account changes on desktop)
  const clientUsername = useMemo(() => {
    if (userStatus?.name && userStatus.name.trim()) {
      return userStatus.name.trim();
    }
    if (userStatus?.email && userStatus.email.trim()) {
      return userStatus.email.trim();
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("name") || "Developer";
  }, [userStatus]);

  // Client avatar initials (e.g. "SZ" for "shuai zhang", "M" for "maoabukeai")
  const clientAvatarInitial = useMemo(() => {
    if (!clientUsername) return "U";
    const parts = clientUsername.trim().split(/[\s._-]+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clientUsername.slice(0, 2).toUpperCase();
  }, [clientUsername]);

  const clientPlanLabel = useMemo(() => {
    if (typeof userStatus?.planStatus === "string" && userStatus.planStatus) {
      return userStatus.planStatus;
    }
    const planInfo = (userStatus?.planStatus as any)?.planInfo?.planName;
    if (planInfo) return planInfo;
    if (userStatus?.userTier?.name) return userStatus.userTier.name;
    return "Google AI Pro";
  }, [userStatus]);

  // Track custom/renamed conversation titles, pinned and archived
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [customTitles, setCustomTitles] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("porta:customTitles") ?? "{}");
    } catch {
      return {};
    }
  });

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("porta:pinnedConversations_v1");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("porta:archivedConversations_v1");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    const handleUpdate = () => {
      try {
        const rawT = localStorage.getItem("porta:customTitles");
        if (rawT) {
          const parsed = JSON.parse(rawT);
          setCustomTitles((prev) => (JSON.stringify(prev) === rawT ? prev : parsed));
        }
      } catch {}
      try {
        const rawP = localStorage.getItem("porta:pinnedConversations_v1");
        const listP: string[] = rawP ? JSON.parse(rawP) : [];
        setPinnedIds((prev) => {
          if (prev.size === listP.length && listP.every((id) => prev.has(id))) {
            return prev;
          }
          return new Set(listP);
        });
      } catch {}
      try {
        const rawA = localStorage.getItem("porta:archivedConversations_v1");
        const listA: string[] = rawA ? JSON.parse(rawA) : [];
        setArchivedIds((prev) => {
          if (prev.size === listA.length && listA.every((id) => prev.has(id))) {
            return prev;
          }
          return new Set(listA);
        });
      } catch {}
    };

    window.addEventListener("porta:conversation-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("porta:conversation-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const startRename = (conv: ConversationEntry) => {
    setEditingId(conv.id);
    setEditTitle(customTitles[conv.id] || conv.summary.summary);
  };

  const saveRename = (id: string) => {
    if (editTitle.trim()) {
      setCustomTitles((prev) => {
        const next = { ...prev, [id]: editTitle.trim() };
        try {
          localStorage.setItem("porta:customTitles", JSON.stringify(next));
        } catch {}
        return next;
      });
      window.dispatchEvent(new Event("porta:conversation-updated"));
    }
    setEditingId(null);
  };

  const togglePin = useCallback((id: string) => {
    if (!id) return;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem(
          "porta:pinnedConversations_v1",
          JSON.stringify(Array.from(next)),
        );
      } catch {}
      return next;
    });
    window.dispatchEvent(new Event("porta:conversation-updated"));
  }, []);

  const getConvTime = useCallback(
    (conv: ConversationEntry) => {
      if (sortBy === "created") {
        const t = conv.summary.createdTime || conv.summary.lastModifiedTime;
        return t ? new Date(t).getTime() : 0;
      }
      return conv.summary.lastModifiedTime
        ? new Date(conv.summary.lastModifiedTime).getTime()
        : 0;
    },
    [sortBy],
  );

  const sortConversations = useCallback(
    (list: ConversationEntry[]) => {
      return [...list].sort((a, b) => {
        const aPinned = pinnedIds.has(a.id);
        const bPinned = pinnedIds.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;

        const aArchived = isArchived(a) || archivedIds.has(a.id);
        const bArchived = isArchived(b) || archivedIds.has(b.id);
        if (aArchived !== bArchived) return aArchived ? 1 : -1;

        const aRunning = a.summary.status === "CASCADE_RUN_STATUS_RUNNING";
        const bRunning = b.summary.status === "CASCADE_RUN_STATUS_RUNNING";
        if (aRunning !== bRunning) return aRunning ? -1 : 1;
        return getConvTime(b) - getConvTime(a);
      });
    },
    [getConvTime, pinnedIds, archivedIds],
  );

  const validConversations = useMemo(() => {
    const sideIds = new Set<string>();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("porta:sideChatCascadeId") || k.startsWith("porta:sideCascadeFor"))) {
          const val = localStorage.getItem(k);
          if (val) sideIds.add(val);
        }
      }
    } catch {}

    const isSubagentConv = (conv: ConversationEntry): boolean => {
      if (!conv || !conv.summary) return false;
      return isSubagentConversation(conv.summary);
    };

    return conversations.filter((conv) => !sideIds.has(conv.id) && !isSubagentConv(conv));
  }, [conversations]);

  const groups = useMemo<WorkspaceGroup[]>(() => {
    const map = new Map<string, { convs: ConversationEntry[]; uri?: string }>();

    for (const conv of validConversations) {
      const name = extractWorkspaceName(conv);
      const uri = conv.summary.workspaces?.[0]?.workspaceFolderAbsoluteUri;
      const item = map.get(name) ?? { convs: [], uri };
      if (!item.uri && uri) item.uri = uri;
      item.convs.push(conv);
      map.set(name, item);
    }

    return Array.from(map.entries())
      .map(([name, { convs, uri }]) => {
        const sortedConvs = sortConversations(convs);
        return {
          name,
          workspaceUri: uri,
          conversations: sortedConvs,
          hasWaiting: sortedConvs.some((c) => waitingIds.has(c.id)),
          hasRunning: sortedConvs.some(
            (c) => c.summary.status === "CASCADE_RUN_STATUS_RUNNING",
          ),
          hasUnread: sortedConvs.some(
            (c) => unreadIds.has(c.id) && c.id !== activeId,
          ),
        };
      })
      .sort((a, b) => {
        const aIsTask = isTaskGroupName(a.name);
        const bIsTask = isTaskGroupName(b.name);
        if (aIsTask && !bIsTask) return 1;
        if (!aIsTask && bIsTask) return -1;
        if (aIsTask && bIsTask) return 0;

        if (customGroupOrder.length > 0) {
          const aIndex = customGroupOrder.indexOf(a.name);
          const bIndex = customGroupOrder.indexOf(b.name);
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
        }

        const aHasActive = a.conversations.some((c) => !isArchived(c));
        const bHasActive = b.conversations.some((c) => !isArchived(c));
        if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
        if (a.hasWaiting !== b.hasWaiting) return a.hasWaiting ? -1 : 1;
        if (a.hasRunning !== b.hasRunning) return a.hasRunning ? -1 : 1;
        if (a.hasUnread !== b.hasUnread) return a.hasUnread ? -1 : 1;
        const aTime = Math.max(0, ...a.conversations.map(getConvTime));
        const bTime = Math.max(0, ...b.conversations.map(getConvTime));

        return bTime - aTime;
      });
  }, [
    validConversations,
    sortConversations,
    unreadIds,
    waitingIds,
    activeId,
    getConvTime,
    customGroupOrder,
  ]);

  const handleGroupDragStart = (e: React.DragEvent, groupName: string) => {
    e.dataTransfer.setData("text/plain", groupName);
    e.dataTransfer.effectAllowed = "move";
    setDraggedGroupName(groupName);
  };

  const handleGroupDragOver = (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedGroupName === groupName) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "top" : "bottom";

    setDragOverGroupName(groupName);
    setDragOverPosition(pos);
  };

  const handleGroupDragLeave = () => {
    setDragOverGroupName(null);
    setDragOverPosition(null);
  };

  const handleGroupDrop = (e: React.DragEvent, targetGroupName: string) => {
    e.preventDefault();
    if (!draggedGroupName || draggedGroupName === targetGroupName) {
      setDraggedGroupName(null);
      setDragOverGroupName(null);
      setDragOverPosition(null);
      return;
    }

    const currentOrder =
      customGroupOrder.length > 0
        ? [...customGroupOrder]
        : groups.map((g) => g.name);

    const fromIdx = currentOrder.indexOf(draggedGroupName);
    if (fromIdx !== -1) {
      currentOrder.splice(fromIdx, 1);
    }

    let toIdx = currentOrder.indexOf(targetGroupName);
    if (toIdx !== -1) {
      if (dragOverPosition === "bottom") {
        toIdx += 1;
      }
      currentOrder.splice(toIdx, 0, draggedGroupName);
    } else {
      currentOrder.push(draggedGroupName);
    }

    setCustomGroupOrder(currentOrder);
    try {
      localStorage.setItem("porta:sidebarGroupOrder_v1", JSON.stringify(currentOrder));
    } catch {}

    setDraggedGroupName(null);
    setDragOverGroupName(null);
    setDragOverPosition(null);
  };

  const handleGroupDragEnd = () => {
    setDraggedGroupName(null);
    setDragOverGroupName(null);
    setDragOverPosition(null);
  };

  const timelineConversations = useMemo(() => {
    return sortConversations(validConversations);
  }, [validConversations, sortConversations]);

  // ── Inline type-to-filter (local, title-based; the server-side search modal stays untouched) ──
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const displayTitleOf = useCallback(
    (conv: ConversationEntry) => {
      const rawTitle = conv.summary.summary || "";
      const isRawHash =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTitle.trim()) ||
        /^[0-9a-f]{8}(?:…|\.\.\.)$/i.test(rawTitle.trim()) ||
        rawTitle === conv.id;
      const cleanSummary = !isRawHash && rawTitle ? rawTitle : "";
      return customTitles[conv.id] || cleanSummary || `任务 (${conv.id.slice(0, 6)})`;
    },
    [customTitles],
  );

  const filterActive = filterQuery.trim().length > 0;
  const statusFilterActive = statusFilter.running || statusFilter.unread;
  const anyFilterActive = filterActive || statusFilterActive;

  const convMatchesFilter = useCallback(
    (conv: ConversationEntry, groupName: string) => {
      if (
        statusFilter.running &&
        conv.summary.status !== "CASCADE_RUN_STATUS_RUNNING"
      ) {
        return false;
      }
      if (statusFilter.unread && !(unreadIds.has(conv.id) && conv.id !== activeId)) {
        return false;
      }
      if (!filterActive) return true;
      const q = filterQuery.trim().toLowerCase();
      return (
        displayTitleOf(conv).toLowerCase().includes(q) ||
        groupName.toLowerCase().includes(q)
      );
    },
    [filterQuery, filterActive, statusFilter, unreadIds, activeId, displayTitleOf],
  );

  const filteredTimeline = useMemo(() => {
    if (!anyFilterActive) return timelineConversations;
    return timelineConversations.filter((c) => convMatchesFilter(c, ""));
  }, [anyFilterActive, timelineConversations, convMatchesFilter]);

  const filteredGroups = useMemo(() => {
    if (!anyFilterActive) return groups;
    return groups
      .map((g) => ({
        ...g,
        conversations: g.conversations.filter((c) => convMatchesFilter(c, g.name)),
      }))
      .filter((g) => g.conversations.length > 0);
  }, [anyFilterActive, groups, convMatchesFilter]);

  const filterMatchCount = anyFilterActive
    ? viewMode === "timeline"
      ? filteredTimeline.length
      : filteredGroups.reduce((n, g) => n + g.conversations.length, 0)
    : 0;

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      try {
        localStorage.setItem("porta:sidebarGroupCollapsed_v1", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const allCollapsed = useMemo(() => {
    if (groups.length === 0) return false;
    return groups.every((g) => collapsed[g.name] === true);
  }, [groups, collapsed]);

  const toggleAllGroups = useCallback(() => {
    if (allCollapsed) {
      setCollapsed({});
      try {
        localStorage.setItem("porta:sidebarGroupCollapsed_v1", JSON.stringify({}));
      } catch {}
    } else {
      const nextCollapsed: Record<string, boolean> = {};
      for (const g of groups) {
        nextCollapsed[g.name] = true;
      }
      setCollapsed(nextCollapsed);
      try {
        localStorage.setItem("porta:sidebarGroupCollapsed_v1", JSON.stringify(nextCollapsed));
      } catch {}
    }
  }, [allCollapsed, groups]);

  // Keyboard shortcut listener (Ctrl+N; Ctrl+K is owned by the App-level command palette)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNew]);

  // Debounced search
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!value.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await api.search(value.trim());
        setSearchResults(data.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
    setSearching(false);
  }, []);

  const renderItem = (conv: ConversationEntry) => {
    const isRunning = conv.summary.status === "CASCADE_RUN_STATUS_RUNNING";
    const isWaiting = waitingIds.has(conv.id);
    const isUnread = unreadIds.has(conv.id) && conv.id !== activeId;
    const displayTitle = displayTitleOf(conv);

    const isConvArchived = isArchived(conv) || archivedIds.has(conv.id);

    const handleConversationContextMenu = (e: React.MouseEvent) => {
      const items: ContextMenuItem[] = [
        {
          key: "open",
          label: "打开对话",
          icon: <IconMessageCheck size={13} className="zcode-dropdown-icon" />,
          onSelect: () => onSelect(conv.id),
        },
        {
          key: "pin",
          label: pinnedIds.has(conv.id) ? "取消置顶" : "置顶",
          icon: <IconPin size={13} className="zcode-dropdown-icon" />,
          onSelect: () => togglePin(conv.id),
        },
      ];
      if (onToggleArchive) {
        items.push({
          key: "archive",
          label: isConvArchived ? "取消归档" : "归档",
          icon: <IconArchive size={13} className="zcode-dropdown-icon" />,
          onSelect: () => onToggleArchive(conv.id),
        });
      }
      items.push(
        {
          key: "rename",
          label: "重命名",
          icon: <IconPencil size={13} className="zcode-dropdown-icon" />,
          onSelect: () => startRename(conv),
        },
        {
          key: "delete",
          label: "删除对话",
          icon: <IconTrash size={13} className="zcode-dropdown-icon" />,
          danger: true,
          dividerBefore: true,
          onSelect: () => onDelete(conv.id),
        },
      );
      conversationContextMenu.openFromMouse(e, items);
    };

    return (
      <div
        key={conv.id}
        className={`sidebar-item zcode-tree-item ${conv.id === activeId ? "active" : ""} ${isWaiting ? "waiting" : isRunning ? "running" : ""} ${isConvArchived ? "dimmed" : ""}`}
        draggable={false}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={handleConversationContextMenu}
        onMouseEnter={() => prefetchSteps(conv.id)}
        onTouchStart={() => prefetchSteps(conv.id)}
        onClick={() => {
          if (editingId === conv.id) return;
          if (unreadIds.has(conv.id)) {
            setUnreadIds((prev) => {
              const next = new Set(prev);
              next.delete(conv.id);
              saveUnreadTasks(next);
              return next;
            });
          }
          onSelect(conv.id);
        }}
      >
        <div className="sidebar-item-content">
          {editingId === conv.id ? (
            <input
              className="sidebar-item-rename-input"
              type="text"
              value={editTitle}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  saveRename(conv.id);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditingId(null);
                }
              }}
              onBlur={() => saveRename(conv.id)}
            />
          ) : (
            <div className="sidebar-item-title zcode-tree-title">
              {pinnedIds.has(conv.id) && (
                <IconPin size={11} className="sidebar-pinned-badge-icon" />
              )}
              <span>{displayTitle}</span>
            </div>
          )}
        </div>

        <div className="sidebar-item-right zcode-tree-meta-right">
          {isWaiting ? (
            <span className="zcode-tree-waiting-wrap" title="等待选择确认 (点击进入对话)">
              <IconHelpCircle size={13} className="item-indicator icon-pulse-amber" />
            </span>
          ) : isRunning ? (
            <span className="zcode-tree-spinner-wrap" title="任务正在执行中...">
              <IconSpinner size={13} className="item-indicator icon-spin" />
            </span>
          ) : isUnread ? (
            <>
              <span
                className="zcode-tree-dot unread"
                title="任务已完成 (未读)"
              />
              <span className="zcode-tree-time">
                {relativeTimeCompact(conv.summary.lastModifiedTime)}
              </span>
            </>
          ) : (
            <span className="zcode-tree-time">
              {relativeTimeCompact(conv.summary.lastModifiedTime)}
            </span>
          )}
          <div
            className="sidebar-item-actions-hover"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`sidebar-item-action-btn ${pinnedIds.has(conv.id) ? "active" : ""}`}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                togglePin(conv.id);
              }}
              title={pinnedIds.has(conv.id) ? "取消置顶" : "置顶对话"}
            >
              <IconPin size={11} />
            </button>
            <button
              type="button"
              className="sidebar-item-action-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startRename(conv);
              }}
              title="重命名"
            >
              <IconPencil size={11} />
            </button>
            <button
              type="button"
              className="sidebar-item-action-btn danger"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onDelete(conv.id);
              }}
              title="删除"
            >
              <IconTrash size={11} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Collapsed state
  if (!isOpen) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <div className="sidebar-collapsed-icons">
          <div
            className="sidebar-collapsed-brand"
            onClick={onToggle}
            title="展开侧栏 (Mcode)"
          >
            <IconMCode size={24} />
          </div>
          <button
            className="sidebar-icon-btn"
            onClick={() => onNew()}
            title="新建任务 (Ctrl+N)"
          >
            <IconPlusCircle size={16} />
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={() => setSearchOpen(true)}
            title="搜索对话"
          >
            <IconSearch size={16} />
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={onSettings}
            title="设置"
          >
            <IconGear size={16} />
          </button>
        </div>
      </aside>
    );
  }

  // Open state
  return (
    <aside
      className={`sidebar zcode-sidebar ${isResizing ? "resizing" : ""}`}
      style={{
        width: `${sidebarWidth}px`,
        minWidth: `${sidebarWidth}px`,
      }}
    >
      {/* 0. Brand Header (Mcode Logo & Branding) */}
      <div className="zcode-brand-header">
        <div
          className="zcode-brand-left"
          onClick={() => onNew()}
          title="新建对话 (Mcode)"
        >
          <IconMCode size={24} className="zcode-brand-logo" />
          <span className="zcode-brand-text">Mcode</span>
        </div>
        <button
          className="zcode-brand-collapse-btn"
          onClick={onToggle}
          title="收起侧栏"
        >
          <IconMenu size={16} />
        </button>
      </div>

      {/* 1. Top Action List (新建任务, 搜索, 技能) */}
      <div className="zcode-sidebar-top-actions">
        <button
          className="zcode-sidebar-nav-btn"
          onClick={() => onNew()}
          title="新建任务 (Ctrl+N)"
        >
          <div className="zcode-nav-btn-left">
            <IconPlusCircle size={15} />
            <span>新建任务</span>
          </div>
          <span className="zcode-hotkey-badge">Ctrl+N</span>
        </button>

        <button
          className="zcode-sidebar-nav-btn"
          onClick={() => {
            setSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
          title="搜索对话"
        >
          <div className="zcode-nav-btn-left">
            <IconSearch size={15} />
            <span>搜索</span>
          </div>
        </button>

        <button
          className="zcode-sidebar-nav-btn"
          onClick={() => {
            window.location.hash = "skills";
          }}
          title="技能与 Prompt 库"
        >
          <div className="zcode-nav-btn-left">
            <IconSparkles size={15} />
            <span>技能</span>
          </div>
        </button>
      </div>

      {/* 1b. Inline type-to-filter (desktop; mobile keeps the search modal) */}
      <div className="porta-sidebar-filter">
        <IconSearch size={13} className="porta-sidebar-filter-icon" />
        <input
          ref={filterInputRef}
          type="text"
          className="porta-sidebar-filter-input"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (filterQuery) {
                setFilterQuery("");
              } else {
                filterInputRef.current?.blur();
              }
            }
          }}
          placeholder="筛选会话…"
          spellCheck={false}
          autoComplete="off"
          title="输入以按标题即时筛选会话列表（Esc 清除）"
        />
        {filterActive && (
          <>
            <span className="porta-sidebar-filter-count">{filterMatchCount}</span>
            <button
              type="button"
              className="porta-sidebar-filter-clear"
              onClick={() => {
                setFilterQuery("");
                filterInputRef.current?.focus();
              }}
              title="清除筛选"
              aria-label="清除筛选"
            >
              <IconX size={12} />
            </button>
          </>
        )}
      </div>

      {/* 1c. Active status-filter chips (removable; shown on all viewports) */}
      {statusFilterActive && (
        <div className="porta-sidebar-status-chips">
          {statusFilter.running && (
            <button
              type="button"
              className="porta-status-chip running"
              onClick={() => toggleStatusFilter("running")}
              title="关闭「只看运行中」过滤"
            >
              <span className="porta-status-chip-dot" />
              只看运行中
              <IconX size={11} />
            </button>
          )}
          {statusFilter.unread && (
            <button
              type="button"
              className="porta-status-chip unread"
              onClick={() => toggleStatusFilter("unread")}
              title="关闭「只看未读」过滤"
            >
              <span className="porta-status-chip-dot" />
              只看未读
              <IconX size={11} />
            </button>
          )}
        </div>
      )}

      {/* 2. Project Toolbar (项目, 收起/展开全部, 筛选/排序, 新建) */}
      <div className="zcode-project-toolbar">
        <div className="zcode-project-pill-group">
          <button
            className="zcode-project-pill active"
            onClick={() => setViewSortMenuOpen((v) => !v)}
            title="切换视图或排序方式"
          >
            {viewMode === "project" ? "项目" : "时间线"}
          </button>
          {viewMode === "project" && (
            <button
              className="zcode-toolbar-icon-btn"
              title={allCollapsed ? "展开全部" : "收起全部"}
              onClick={toggleAllGroups}
              aria-label={allCollapsed ? "展开全部" : "收起全部"}
            >
              {allCollapsed ? (
                <IconExpandAll size={13} />
              ) : (
                <IconCollapseAll size={13} />
              )}
            </button>
          )}
        </div>

        <div className="zcode-toolbar-actions-right">
          <button
            ref={filterBtnRef}
            className={`zcode-toolbar-icon-btn ${viewSortMenuOpen ? "active" : ""}`}
            title="视图与排序方式"
            onClick={() => setViewSortMenuOpen((v) => !v)}
            aria-expanded={viewSortMenuOpen}
          >
            <IconFilter size={13} />
          </button>
          <button
            className="zcode-toolbar-icon-btn"
            title="新建对话"
            onClick={() => onNew()}
          >
            <IconPlus size={13} />
          </button>

          {/* View & Sort Popover Menu (Matches Reference) */}
          {viewSortMenuOpen && (
            <div
              className="zcode-filter-popover"
              ref={viewSortMenuRef}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="zcode-filter-section-title">视图</div>
              <button
                className={`zcode-filter-item ${viewMode === "project" ? "active" : ""}`}
                onClick={() => {
                  setViewMode("project");
                  localStorage.setItem("porta:sidebarViewMode", "project");
                  setViewSortMenuOpen(false);
                }}
              >
                <div className="zcode-filter-item-left">
                  <IconFolder size={14} className="zcode-filter-icon" />
                  <span>按项目</span>
                </div>
                {viewMode === "project" && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>
              <button
                className={`zcode-filter-item ${viewMode === "timeline" ? "active" : ""}`}
                onClick={() => {
                  setViewMode("timeline");
                  localStorage.setItem("porta:sidebarViewMode", "timeline");
                  setViewSortMenuOpen(false);
                }}
              >
                <div className="zcode-filter-item-left">
                  <IconClock size={14} className="zcode-filter-icon" />
                  <span>时间线</span>
                </div>
                {viewMode === "timeline" && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>

              <div className="zcode-filter-divider" />

              <div className="zcode-filter-section-title">排序方式</div>
              <button
                className={`zcode-filter-item ${sortBy === "updated" ? "active" : ""}`}
                onClick={() => {
                  setSortBy("updated");
                  localStorage.setItem("porta:sidebarSortBy", "updated");
                  setViewSortMenuOpen(false);
                }}
              >
                <div className="zcode-filter-item-left">
                  <IconMessageCheck size={14} className="zcode-filter-icon" />
                  <span>更新时间</span>
                </div>
                {sortBy === "updated" && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>
              <button
                className={`zcode-filter-item ${sortBy === "created" ? "active" : ""}`}
                onClick={() => {
                  setSortBy("created");
                  localStorage.setItem("porta:sidebarSortBy", "created");
                  setViewSortMenuOpen(false);
                }}
              >
                <div className="zcode-filter-item-left">
                  <IconMessagePlus size={14} className="zcode-filter-icon" />
                  <span>创建时间</span>
                </div>
                {sortBy === "created" && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>

              <div className="zcode-filter-divider" />

              <div className="zcode-filter-section-title">快捷过滤</div>
              <button
                className={`zcode-filter-item ${statusFilter.running ? "active" : ""}`}
                onClick={() => toggleStatusFilter("running")}
                title="仅显示正在执行任务的会话（可与未读组合）"
              >
                <div className="zcode-filter-item-left">
                  <IconPlay size={14} className="zcode-filter-icon" />
                  <span>只看运行中</span>
                </div>
                {statusFilter.running && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>
              <button
                className={`zcode-filter-item ${statusFilter.unread ? "active" : ""}`}
                onClick={() => toggleStatusFilter("unread")}
                title="仅显示有未读完成消息的会话（可与运行中组合）"
              >
                <div className="zcode-filter-item-left">
                  <IconEye size={14} className="zcode-filter-icon" />
                  <span>只看未读</span>
                </div>
                {statusFilter.unread && (
                  <IconCheck size={13} className="zcode-filter-check" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Folder Trees & Tasks List */}
      <div className="sidebar-list zcode-tree-list">
        {loading && conversations.length === 0 ? (
          <div
            style={{ display: "flex", justifyContent: "center", padding: 20 }}
          >
            <div className="loading-spinner" />
          </div>
        ) : anyFilterActive && filterMatchCount === 0 ? (
          <div className="porta-sidebar-filter-empty">
            <span>
              {filterActive
                ? "没有匹配的会话"
                : statusFilter.running && statusFilter.unread
                  ? "没有运行中的未读会话"
                  : statusFilter.running
                    ? "没有运行中的会话"
                    : "没有未读会话"}
            </span>
            <button
              type="button"
              onClick={() => {
                setFilterQuery("");
                if (statusFilter.running) toggleStatusFilter("running");
                if (statusFilter.unread) toggleStatusFilter("unread");
              }}
            >
              清除筛选
            </button>
          </div>
        ) : viewMode === "timeline" ? (
          <div className="workspace-group-items zcode-tree-items">
            {filteredTimeline.map(renderItem)}
          </div>
        ) : (
          filteredGroups.map((group) => {
            const totalCount = group.conversations.length;
            // Filtering forces groups open so matches stay visible
            const isGroupCollapsed = anyFilterActive
              ? false
              : collapsed[group.name] ?? false;
            const isTask = isTaskGroupName(group.name);

            return (
              <div
                key={group.name}
                className={`workspace-group zcode-tree-group ${
                  draggedGroupName === group.name ? "dragging" : ""
                } ${
                  dragOverGroupName === group.name
                    ? `drag-over-${dragOverPosition || "top"}`
                    : ""
                }`}
                onDragOver={(e) => handleGroupDragOver(e, group.name)}
                onDragLeave={handleGroupDragLeave}
                onDrop={(e) => handleGroupDrop(e, group.name)}
              >
                <div
                  className="workspace-group-header-row zcode-tree-header-row"
                  draggable={viewMode === "project"}
                  onDragStart={(e) => handleGroupDragStart(e, group.name)}
                  onDragEnd={handleGroupDragEnd}
                  onClick={() => toggleGroup(group.name)}
                >
                  <div className="zcode-tree-header-left">
                    <IconChevron
                      size={10}
                      className={`workspace-group-chevron zcode-tree-chevron ${isGroupCollapsed ? "collapsed" : ""}`}
                    />
                    {isTask ? (
                      <IconMessagePlus size={14} className="zcode-tree-folder-icon" />
                    ) : isGroupCollapsed ? (
                      <IconFolder size={14} className="zcode-tree-folder-icon" />
                    ) : (
                      <IconFolderOpen size={14} className="zcode-tree-folder-icon open" />
                    )}
                    <span className="workspace-group-name zcode-tree-folder-name">{group.name}</span>
                  </div>

                  <div className="zcode-tree-header-right">
                    {group.hasWaiting ? (
                      <span className="zcode-tree-waiting-wrap" title="文件夹内有等待您选择/确认的任务">
                        <IconHelpCircle size={13} className="item-indicator icon-pulse-amber" />
                      </span>
                    ) : group.hasRunning ? (
                      <span className="zcode-tree-spinner-wrap" title="文件夹内有正在进行的任务">
                        <IconSpinner size={12} className="item-indicator icon-spin" />
                      </span>
                    ) : group.hasUnread ? (
                      <span className="zcode-tree-dot unread" title="文件夹内有未读已完成任务" />
                    ) : null}
                    <span className="workspace-group-count zcode-tree-count">{totalCount}</span>
                    <button
                      type="button"
                      className="workspace-group-new-btn zcode-tree-new-btn"
                      title={isTask ? "新建独立任务 (不关联项目)" : `在「${group.name}」中新建任务`}
                      aria-label={isTask ? "新建独立任务 (不关联项目)" : `在「${group.name}」中新建任务`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNew(isTask ? null : group.workspaceUri);
                      }}
                    >
                      <IconPlus size={11} />
                    </button>
                  </div>
                </div>

                {!isGroupCollapsed && (
                  <div className="workspace-group-items zcode-tree-items">
                    {group.conversations.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 4. Resizer Grip Handle */}
      <div
        className={`zcode-sidebar-resize-handle ${isResizing ? "active" : ""}`}
        onPointerDown={handleResizeStart}
        onDoubleClick={handleDoubleClickReset}
        title="按住左右拖动调整宽度，双击重置默认宽度"
      >
        <div className="zcode-resize-grip">
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* 5. Bottom User Footer */}
      <div className="zcode-sidebar-footer">
        <div
          className="zcode-footer-user"
          onClick={() => setQuotaOpen(true)}
          title={`${clientUsername}${userStatus?.email ? ` (${userStatus.email})` : ""} · ${clientPlanLabel} (点击查看实时额度)`}
        >
          <div className="zcode-footer-avatar">
            <span className="zcode-avatar-fallback">
              {clientAvatarInitial}
            </span>
          </div>
          <div className="zcode-footer-user-info">
            <span className="zcode-footer-username">{clientUsername}</span>
            {userStatus?.email && (
              <span className="zcode-footer-user-email">{userStatus.email}</span>
            )}
          </div>
        </div>

        <button
          className="zcode-footer-settings-btn"
          onClick={onSettings}
          title="系统设置"
        >
          <IconGear size={15} />
        </button>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div className="search-modal-overlay" onClick={closeSearch}>
          <div
            className="search-modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
          >
            <div className="search-modal-header">
              <IconSearch size={16} className="search-modal-icon" />
              <input
                ref={searchInputRef}
                className="search-modal-input"
                type="text"
                placeholder="搜索任务、历史指令..."
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                autoFocus
              />
              <button className="search-modal-close" onClick={closeSearch}>
                <IconX size={13} />
              </button>
            </div>
            <div className="search-modal-results">
              {searching ? (
                <div className="search-modal-status">
                  <div className="loading-spinner" />
                </div>
              ) : searchResults === null ? (
                <div className="search-modal-status">
                  输入关键词以在所有历史任务中快速检索
                </div>
              ) : searchResults.length === 0 ? (
                <div className="search-modal-status">
                  没有找到关于 "{searchQuery}" 的结果
                </div>
              ) : (
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    className="search-result-item"
                    onClick={() => {
                      onSelect(result.id);
                      closeSearch();
                    }}
                  >
                    <div className="search-result-title">{result.title}</div>
                    <div className="search-result-snippets">
                      {result.snippets.map((s, i) => (
                        <div key={i} className="search-result-snippet">
                          {s}
                        </div>
                      ))}
                    </div>
                    <div className="search-result-meta">
                      {result.matchCount} 处匹配
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Account Quota Popover (Instant fetch & real-time refresh, floating directly above user bar) */}
      <AccountQuotaModal
        isOpen={quotaOpen}
        onClose={() => setQuotaOpen(false)}
        onOpenSettings={onSettings}
        sidebarWidth={sidebarWidth}
        initialData={userStatusData}
      />

      {/* Desktop right-click menu for conversations (portal → body) */}
      {conversationContextMenu.menu}
    </aside>
  );
}
