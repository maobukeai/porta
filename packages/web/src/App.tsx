import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import {
  Routes,
  Route,
  useParams,
  useNavigate,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ChatHeader } from "./components/ChatHeader";
import { ChatPanel } from "./components/ChatPanel";
import { ChatInput } from "./components/ChatInput";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { extractArtifactsFromSteps } from "./utils/extractArtifacts";
import {
  convertMediaToAttachmentPreviews,
  type AttachmentPreview,
} from "./utils/imageAttachments";
import { IconFolder, IconSparkles, IconSpinner, IconTerminal } from "./components/Icons";
import { ConnectionLoadingScreen } from "./components/ConnectionLoadingScreen";

const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
const SidePanel = lazy(() =>
  import("./components/SidePanel").then((m) => ({ default: m.SidePanel })),
);
import type { SidePanelTab } from "./components/SidePanel";
const QuickSwitchSheet = lazy(() =>
  import("./components/QuickSwitchSheet").then((m) => ({ default: m.QuickSwitchSheet })),
);
import { ExportModal } from "./components/ExportModal";
import { ChatScrollSlider } from "./components/ChatScrollSlider";
import { stepsToMessages } from "./transforms/stepsToMessages";
import { useConversations } from "./hooks/useConversations";
import { usePolling } from "./hooks/usePolling";
import { getStepsFromCache } from "./hooks/useStepsStream";
import { useWorkspaces, slugFromUri } from "./hooks/useWorkspaces";
import { useDraftText } from "./hooks/useDraftText";
import { useChatActions } from "./hooks/useChatActions";
import { useClientSettings } from "./hooks/useClientSettings";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { useSidebarSwipe } from "./hooks/useSidebarSwipe";
import { api } from "./api/client";
import { isUnconfirmedOptimisticMessage } from "./utils/optimisticMessages";
import type { AskQuestionEntry, HealthResponse, MediaAttachment } from "./types";
import type { PlannerType } from "./components/ChatInput";
import { triggerHaptic } from "./utils/haptics";
import { SetupWizard } from "./components/SetupWizard";

export default function App() {
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  useEffect(() => {
    const cap = (window as any).Capacitor;
    const isNative = Boolean(
      cap?.isNativePlatform?.() ||
      cap?.platform === "android" ||
      cap?.platform === "ios",
    );
    if (isNative && !localStorage.getItem("porta_custom_api_base")) {
      setShowSetupWizard(true);
    }
  }, []);

  return (
    <>
      {showSetupWizard && createPortal(
        <SetupWizard onClose={() => setShowSetupWizard(false)} />,
        document.body,
      )}
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/:projectSlug/settings" element={<ChatView />} />
        <Route path="/:projectSlug" element={<ChatView />} />
        <Route path="/:projectSlug/:chatId" element={<ChatView />} />
      </Routes>
    </>
  );
}

// ── Root redirect: go to the first workspace's new-chat page ──

function RootRedirect() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    api
      .getWorkspaces()
      .then((data) => {
        const first = data.workspaceInfos?.[0];
        if (first) {
          setTarget(`/${slugFromUri(first.workspaceUri)}`);
        } else {
          setTarget("/unknown");
        }
      })
      .catch(() => {
        // If the API fails, stay put — ChatView will handle empty state
        // We still need to bounce the user to ChatView, though.
        setTarget("/unknown");
      });
  }, []);

  if (target) return <Navigate to={target} replace />;
  return <ConnectionLoadingScreen />;
}

// ── Main Chat View ──

function ChatView() {
  const { projectSlug, chatId } = useParams<{
    projectSlug: string;
    chatId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsPage = location.pathname.endsWith("/settings");
  const activeId = chatId ?? null;
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 480);
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab | null>(null);
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("porta:sidePanelWidth");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 280 && parsed <= 1200) {
          return parsed;
        }
      }
    } catch {}
    return 480;
  });
  const [isResizingSidePanel, setIsResizingSidePanel] = useState(false);

  const handleSidePanelResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingSidePanel(true);
    triggerHaptic("light");

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const clientX =
        "touches" in moveEvent
          ? moveEvent.touches[0].clientX
          : (moveEvent as MouseEvent).clientX;

      const windowW = window.innerWidth;
      const newWidth = Math.max(300, Math.min(windowW - 200, windowW - clientX));
      setSidePanelWidth(newWidth);
    };

    const onEnd = () => {
      setIsResizingSidePanel(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      setSidePanelWidth((finalWidth) => {
        try {
          localStorage.setItem("porta:sidePanelWidth", String(finalWidth));
        } catch {}
        return finalWidth;
      });
    };

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    path?: string;
    ext?: string;
    range?: string;
  } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const emptyScrollRef = useRef<HTMLDivElement | null>(null);
  // Right panel drag-to-dismiss state
  const panelDragRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null);
  const panelElRef = useRef<HTMLDivElement | null>(null);
  const panelDraggingRef = useRef(false);
  const isMobile = () => window.innerWidth <= 480;
  const { conversations, loading, refresh, optimisticRemove } = useConversations(8_000);
  const { data: health } = usePolling<HealthResponse>(api.health, 30_000);

  const handleOpenFile = useCallback(
    (file: { name: string; path?: string; ext?: string; range?: string }) => {
      setSelectedFile(file);
      setSidePanelTab("review");
      setArtifactsOpen(true);
    },
    [],
  );

  // ── Global Keyboard Shortcuts (Ctrl+` for Terminal in Side Panel, Ctrl+Alt+B for Side Pane) ──
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      // Ctrl+` -> Toggle Terminal in Side Panel
      if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.key === "~")) {
        e.preventDefault();
        setArtifactsOpen((prev) => {
          if (prev && sidePanelTab === "terminal") {
            return false;
          }
          setSidePanelTab("terminal");
          return true;
        });
      }
      // Ctrl+Alt+B -> Toggle Side Panel
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setArtifactsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [sidePanelTab]);

  // ── Steps Cache for Artifacts Extraction & Subagent Viewer ──
  const steps = getStepsFromCache(activeId ?? "");
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);

  useEffect(() => {
    setActiveSubagentId(null);
  }, [activeId]);

  const handleSelectSubagent = useCallback((subagentId: string) => {
    setActiveSubagentId(subagentId);
    setSidePanelTab("subagent");
    setArtifactsOpen(true);
  }, []);

  // ── Hooks ──
  const { workspaces, currentWorkspaceUri } = useWorkspaces(
    conversations,
    projectSlug,
  );
  const { draftText, handleDraftChange } = useDraftText(activeId);
  const [draftAttachments, setDraftAttachments] = useState<AttachmentPreview[]>([]);
  const { settings, updateSettings } = useClientSettings();
  useVisualViewport();
  useSidebarSwipe({
    isOpen: sidebarOpen,
    onOpen: () => setSidebarOpen(true),
    onClose: () => setSidebarOpen(false),
  });

  // ── Global Theme Application ──
  useEffect(() => {
    const currentTheme = settings.theme ?? "dark";
    const apply = (t: string) => {
      let effective = t;
      if (t === "system") {
        effective = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      }
      document.documentElement.setAttribute("data-theme", effective);
      document.documentElement.classList.toggle("theme-dark", effective === "dark");
      document.documentElement.classList.toggle("theme-light", effective === "light");
    };

    apply(currentTheme);

    if (currentTheme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        apply(e.matches ? "dark" : "light");
      };
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
  }, [settings.theme]);

  const activeConv = conversations.find((c) => c.id === activeId);
  const isRunning = activeConv?.summary.status === "CASCADE_RUN_STATUS_RUNNING";
  const connected = !!health && health.languageServers.length > 0;

  const {
    optimisticMessages,
    setOptimisticMessages,
    confirmOptimisticMessages,
    stepsRefreshKey,
    hardRefreshKey,
    handleSend: doSend,
    handleStop,

    handleRevert: rawHandleRevert,
    handleDelete,
    chatUrl,
    triggerSoftRefresh,
  } = useChatActions({
    activeId,
    currentWorkspaceUri,
    projectSlug,
    refresh,
    conversations,
    optimisticRemove,
  });

  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);
  const [gitChangesCount, setGitChangesCount] = useState<number>(0);

  useEffect(() => {
    if (currentWorkspaceUri) {
      api
        .gitStatus(currentWorkspaceUri)
        .then((res) => {
          if (res.branch) setGitBranch(res.branch);
          if (typeof res.totalChanges === "number") setGitChangesCount(res.totalChanges);
        })
        .catch(() => {});
    }
  }, [currentWorkspaceUri, artifactsOpen]);

  const artifactsCount = useMemo(
    () => extractArtifactsFromSteps(steps, optimisticMessages).length,
    [steps, optimisticMessages],
  );

  // Wire handleRevert to also update draft text and restored image attachments
  const handleRevert = useCallback(
    async (stepIndex: number, draftContent?: string, draftMedia?: unknown[]) => {
      await rawHandleRevert(stepIndex, draftContent);
      if (draftContent !== undefined) {
        handleDraftChange(draftContent);
      }
      if (draftMedia && Array.isArray(draftMedia) && draftMedia.length > 0) {
        const restored = convertMediaToAttachmentPreviews(draftMedia);
        setDraftAttachments(restored);
      }
    },
    [rawHandleRevert, handleDraftChange],
  );

  // ── Send: grant file access according to executionMode ──
  const handleSend = useCallback(
    async (
      text: string,
      model: string | null = null,
      media?: MediaAttachment[],
      plannerType?: PlannerType,
      executionMode?: import("./types").ExecutionMode,
    ) => {
      const autoGrant = executionMode !== "review_before_edit";
      doSend(text, model, media, plannerType, autoGrant, executionMode);
    },
    [doSend],
  );

  // ── Per-file permission response ──
  const handleFilePermission = useCallback(
    async (
      trajectoryId: string,
      stepIndex: number,
      allow: boolean,
      scope: number,
      absolutePathUri: string,
    ) => {
      if (!activeId) return;
      try {
        await api.filePermission(
          activeId,
          trajectoryId,
          stepIndex,
          allow,
          scope,
          absolutePathUri,
        );
        // WS activate signal (emitted by proxy) handles real-time push.
        // Soft refresh as insurance — non-destructive merge, no screen blank.
        triggerSoftRefresh();
        refresh();
      } catch (err) {
        console.error("Failed to respond to file permission:", err);
      }
    },
    [activeId, refresh, triggerSoftRefresh],
  );

  // ── Command action (approve/reject proposed command) ──
  const handleCommandAction = useCallback(
    async (
      trajectoryId: string,
      stepIndex: number,
      approved: boolean,
    ) => {
      if (!activeId) return;
      try {
        await api.commandAction(
          activeId,
          trajectoryId,
          stepIndex,
          approved,
        );
        triggerSoftRefresh();
        refresh();
      } catch (err) {
        console.error("Failed to respond to command action:", err);
        throw err; // Propagate so CommandCard can restore buttons
      }
    },
    [activeId, refresh, triggerSoftRefresh],
  );

  // ── Ask question response (Antigravity choice prompts) ──
  const handleAskQuestion = useCallback(
    async (
      trajectoryId: string,
      stepIndex: number,
      responses: AskQuestionEntry[],
      cancelled = false,
    ) => {
      if (!activeId) return;
      try {
        await api.askQuestion(
          activeId,
          trajectoryId,
          stepIndex,
          responses,
          cancelled,
        );
        triggerSoftRefresh();
        refresh();
      } catch (err) {
        console.error("Failed to respond to question:", err);
        throw err;
      }
    },
    [activeId, refresh, triggerSoftRefresh],
  );

  // ── Navigate helpers ──
  const handleNew = useCallback((workspaceUri?: string | null) => {
    if (workspaceUri) {
      navigate(`/${slugFromUri(workspaceUri)}`);
    } else if (workspaceUri === null) {
      navigate("/tasks");
    } else {
      navigate(`/${projectSlug ?? "tasks"}`);
    }
    setOptimisticMessages([]);
    if (isMobile()) setSidebarOpen(false);
  }, [navigate, projectSlug, setOptimisticMessages]);

  // Track custom/renamed titles, pinned and archived conversations
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

  const handleRenameConversation = useCallback((id: string, newTitle: string) => {
    if (!id || !newTitle.trim()) return;
    setCustomTitles((prev) => {
      const next = { ...prev, [id]: newTitle.trim() };
      try {
        localStorage.setItem("porta:customTitles", JSON.stringify(next));
      } catch {}
      return next;
    });
    window.dispatchEvent(new Event("porta:conversation-updated"));
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    if (!id) return;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem("porta:pinnedConversations_v1", JSON.stringify([...next]));
      } catch {}
      return next;
    });
    window.dispatchEvent(new Event("porta:conversation-updated"));
  }, []);

  const handleToggleArchive = useCallback((id: string) => {
    if (!id) return;
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem("porta:archivedConversations_v1", JSON.stringify([...next]));
        window.dispatchEvent(new Event("porta:conversation-updated"));
      } catch {}
      return next;
    });
  }, []);

  // Header info
  const headerTitle = activeId
    ? (customTitles[activeId] || (activeConv?.summary.summary ?? "会话"))
    : "新建对话";

  // ── Mobile Swipe Gestures ──
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobile()) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      const dx = touchEndX - touchStartX.current;
      const dy = touchEndY - touchStartY.current;

      // Must be primarily horizontal
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        if (dx > 0 && touchStartX.current < 30) {
          // Swipe right from the far left edge → open
          setSidebarOpen(true);
        } else if (dx < 0 && sidebarOpen) {
          // Swipe left anywhere → close
          setSidebarOpen(false);
        }
      }
    },
    [sidebarOpen],
  );

  const handleConnectingComplete = useCallback(() => {
    setIsConnecting(false);
  }, []);

  if (isConnecting && conversations.length === 0) {
    return <ConnectionLoadingScreen onComplete={handleConnectingComplete} />;
  }

  return (
    <div
      className="app-layout"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setOptimisticMessages([]);
          navigate(chatUrl(id));
          if (isMobile()) setSidebarOpen(false);
        }}
        onNew={handleNew}
        onDelete={handleDelete}
        onSettings={() => {
          navigate(`/${projectSlug ?? "unknown"}/settings`);
          if (isMobile()) setSidebarOpen(false);
        }}
        loading={loading}
        connected={connected}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      {/* Mobile/Responsive backdrop: click or tap anywhere outside to close sidebar */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          onTouchStart={() => setSidebarOpen(false)}
        />
      )}
      <div className="main-panel">
        <ChatHeader
          title={headerTitle}
          projectName={projectSlug ?? undefined}
          conversationId={activeId ?? undefined}
          gitBranch={gitBranch}
          gitChangesCount={gitChangesCount}
          onMenuToggle={() => setSidebarOpen(true)}
          onQuickSwitch={() => setQuickSwitchOpen(true)}
          onNewChat={handleNew}
          onOpenSettings={() => {
            navigate(`/${projectSlug ?? "unknown"}/settings`);
            if (isMobile()) setSidebarOpen(false);
          }}
          onToggleArtifacts={() => {
            if (artifactsOpen && sidePanelTab === null) {
              setArtifactsOpen(false);
            } else {
              setSelectedFile(null);
              setSidePanelTab(null);
              setArtifactsOpen(true);
            }
          }}
          onOpenGit={() => {
            if (artifactsOpen && sidePanelTab === "git") {
              setArtifactsOpen(false);
            } else {
              setSidePanelTab("git");
              setArtifactsOpen(true);
            }
          }}
          onOpenReview={() => {
            if (artifactsOpen && sidePanelTab === "review") {
              setArtifactsOpen(false);
            } else {
              setSidePanelTab("review");
              setArtifactsOpen(true);
            }
          }}
          onToggleTerminal={() => {
            if (artifactsOpen && sidePanelTab === "terminal") {
              setArtifactsOpen(false);
            } else {
              setSidePanelTab("terminal");
              setArtifactsOpen(true);
            }
          }}
          onOpenExport={() => setExportOpen(true)}
          artifactsCount={artifactsCount}
          isArtifactsOpen={artifactsOpen && sidePanelTab !== "terminal"}
          isTerminalOpen={artifactsOpen && sidePanelTab === "terminal"}
          onRename={handleRenameConversation}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onToggleArchive={handleToggleArchive}
          isPinned={activeId ? pinnedIds.has(activeId) : false}
          isArchived={activeId ? archivedIds.has(activeId) : false}
        />

        {/* Mobile Quick Switch Bottom Drawer */}
        <Suspense fallback={null}>
          <QuickSwitchSheet
            isOpen={quickSwitchOpen}
            onClose={() => setQuickSwitchOpen(false)}
            conversations={conversations}
            activeId={activeId}
            currentProjectSlug={projectSlug}
            onSelectChat={(id) => {
              setOptimisticMessages([]);
              navigate(chatUrl(id));
              if (isMobile()) setSidebarOpen(false);
            }}
            onNewChat={handleNew}
            onOpenSidebar={() => setSidebarOpen(true)}
            workspaces={workspaces}
            onSelectProject={(slug) => {
              navigate(`/${slug}`);
            }}
          />
        </Suspense>

        <div className="main-content-layout">
          {isSettingsPage ? (
            <Suspense fallback={<div className="artifacts-loading"><IconSpinner className="icon-spin" /></div>}>
              <SettingsPanel
                settings={settings}
                onUpdate={updateSettings}
                onBack={() => navigate(`/${projectSlug ?? "unknown"}`)}
              />
            </Suspense>
          ) : (
            <>
              <div className="chat-view-pane">
                {activeId ? (
                  <ChatPanel
                    cascadeId={activeId}
                    activeSubagentId={activeSubagentId}
                    onSelectSubagent={handleSelectSubagent}
                    onCloseSubagent={() => setActiveSubagentId(null)}
                    onRevert={handleRevert}
                    onFilePermission={handleFilePermission}
                    onCommandAction={handleCommandAction}
                    onAskQuestion={handleAskQuestion}
                    onConfirmOptimistic={confirmOptimisticMessages}
                    optimisticMessages={optimisticMessages}
                    refreshKey={stepsRefreshKey}
                    hardRefreshKey={hardRefreshKey}
                    totalStepCount={activeConv?.summary.stepCount}
                    isConversationRunning={isRunning}
                    browserNotificationsEnabled={settings.browserNotificationsEnabled}
                    conversationTitle={headerTitle}
                    onQuoteMessage={(text) =>
                      handleDraftChange(
                        draftText ? `${draftText}\n> ${text}\n` : `> ${text}\n`,
                      )
                    }
                    onOpenFile={handleOpenFile}
                    onOpenReview={() => {
                      setSidePanelTab("review");
                      setArtifactsOpen(true);
                    }}
                    onOpenSubagents={() => {
                      setSidePanelTab("subagent_directory");
                      setArtifactsOpen(true);
                    }}
                    onSidebarRefresh={refresh}
                    onSendMessage={(text) => {
                      void handleSend(text);
                    }}
                  />
                ) : (
                  <div className="chat-area-container">
                    <div
                      className="chat-area"
                      ref={emptyScrollRef}
                      onTouchMove={() => {
                        const el = document.activeElement;
                        if (
                          el instanceof HTMLTextAreaElement ||
                          el instanceof HTMLInputElement
                        ) {
                          el.blur();
                        }
                      }}
                    >
                      <div className="chat-area-inner">
                        {optimisticMessages.map((msg, i) => (
                          <div
                            key={msg.optimisticId ?? i}
                            className={`message ${msg.role}${isUnconfirmedOptimisticMessage(msg) ? " unconfirmed" : ""}`}
                          >
                            <div className="chat-block message-body">
                              <p>{msg.content}</p>
                            </div>
                          </div>
                        ))}
                        {optimisticMessages.some(isUnconfirmedOptimisticMessage) && (
                          <div className="message assistant">
                            <div className="chat-block message-body">
                              <div className="typing-indicator">
                                <span />
                                <span />
                                <span />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      {optimisticMessages.length === 0 && (
                        <div className="chat-empty">
                          <h1 className="chat-empty-title">你想在代码中构建什么？</h1>
                          <p className="chat-empty-subtitle">
                            从分析项目、制定计划、开发新特性到智能调试，AI 协助全流程远程开发
                          </p>

                          <div className="chat-empty-grid">
                            <div
                              className="chat-prompt-card"
                              onClick={() => {
                                handleDraftChange("帮我全面分析当前工作区的代码架构、技术栈与核心模块");
                              }}
                            >
                              <div className="chat-prompt-icon">
                                <IconSparkles size={16} />
                              </div>
                              <div className="chat-prompt-info">
                                <div className="chat-prompt-title">探索项目架构</div>
                                <div className="chat-prompt-desc">分析目录结构、核心依赖与关键入口</div>
                              </div>
                            </div>

                            <div
                              className="chat-prompt-card"
                              onClick={() => {
                                handleDraftChange("请针对我接下来的功能需求，编写一份结构化实施计划与任务分解");
                              }}
                            >
                              <div className="chat-prompt-icon">
                                <IconFolder size={16} />
                              </div>
                              <div className="chat-prompt-info">
                                <div className="chat-prompt-title">制定实施计划</div>
                                <div className="chat-prompt-desc">多步骤任务分解与风险检查点规划</div>
                              </div>
                            </div>

                            <div
                              className="chat-prompt-card"
                              onClick={() => {
                                handleDraftChange("对当前项目进行代码审查，排查潜在 Bug、类型错误与性能瓶颈");
                              }}
                            >
                              <div className="chat-prompt-icon">
                                <IconTerminal size={16} />
                              </div>
                              <div className="chat-prompt-info">
                                <div className="chat-prompt-title">代码缺陷诊断</div>
                                <div className="chat-prompt-desc">排查逻辑隐患、内存泄漏与异常行为</div>
                              </div>
                            </div>

                            <div
                              className="chat-prompt-card"
                              onClick={() => {
                                handleDraftChange("运行项目的构建检查与测试套件，验证项目是否可正常编译通过");
                              }}
                            >
                              <div className="chat-prompt-icon">
                                <IconSparkles size={16} />
                              </div>
                              <div className="chat-prompt-info">
                                <div className="chat-prompt-title">构建与测试验证</div>
                                <div className="chat-prompt-desc">执行 pnpm build 与自动化测试套件</div>
                              </div>
                            </div>
                          </div>

                          {workspaces.length > 0 && currentWorkspaceUri ? (
                            <div className="chat-empty-workspace-card">
                              <WorkspaceSelector
                                workspaces={workspaces}
                                selected={currentWorkspaceUri}
                                onSelect={(uri) => {
                                  const slug = slugFromUri(uri);
                                  navigate(`/${slug}`);
                                }}
                              />
                            </div>
                          ) : (
                            <div className="chat-empty-project">
                              <IconFolder size={13} /> {projectSlug ?? "任务"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <ChatScrollSlider targetRef={emptyScrollRef} />
                  </div>
                )}
                <ChatInput
                  onSend={handleSend}
                  onStop={handleStop}
                  isRunning={isRunning}
                  disabled={false}
                  draft={draftText}
                  onDraftChange={handleDraftChange}
                  draftAttachments={draftAttachments}
                  onDraftAttachmentsChange={setDraftAttachments}
                  defaultModel={settings.defaultModel}
                  defaultPlannerType={settings.defaultPlannerType}
                  defaultExecutionMode={settings.defaultExecutionMode}
                  workspaceUri={currentWorkspaceUri}
                />
              </div>

              {artifactsOpen && (
                <>
                  <div
                    className="artifacts-backdrop"
                    style={panelDraggingRef.current ? { transition: "none" } : undefined}
                    onClick={() => setArtifactsOpen(false)}
                    onTouchStart={() => setArtifactsOpen(false)}
                  />
                  <div
                    ref={panelElRef}
                    className={`artifacts-side-pane ${isResizingSidePanel ? "is-resizing" : ""}`}
                    style={
                      window.innerWidth > 480
                        ? { width: `${sidePanelWidth}px`, maxWidth: "85vw" }
                        : undefined
                    }
                    onTouchStart={(e) => {
                      if (e.touches.length === 1) {
                        touchStartRef.current = {
                          x: e.touches[0].clientX,
                          y: e.touches[0].clientY,
                        };
                        panelDragRef.current = {
                          startX: e.touches[0].clientX,
                          startY: e.touches[0].clientY,
                          startTime: Date.now(),
                        };
                      }
                    }}
                    onTouchMove={(e) => {
                      const drag = panelDragRef.current;
                      if (!drag || e.touches.length !== 1) return;
                      const dx = e.touches[0].clientX - drag.startX;
                      const dy = Math.abs(e.touches[0].clientY - drag.startY);
                      // Only track rightward horizontal drags
                      if (dx > 0 && dx > dy) {
                        e.stopPropagation();
                        panelDraggingRef.current = true;
                        if (panelElRef.current) {
                          panelElRef.current.style.transform = `translateX(${dx}px)`;
                          panelElRef.current.style.transition = "none";
                        }
                      }
                    }}
                    onTouchEnd={(e) => {
                      const drag = panelDragRef.current;
                      if (drag && e.changedTouches.length === 1) {
                        const dx = e.changedTouches[0].clientX - drag.startX;
                        const dy = Math.abs(e.changedTouches[0].clientY - drag.startY);
                        const dt = Date.now() - drag.startTime;
                        const velocity = dx / dt; // px/ms
                        if (dx > 0 && dy < 80) {
                          // Fast flick OR dragged more than 40% of panel width
                          const panelW = panelElRef.current?.offsetWidth ?? 300;
                          if (velocity > 0.4 || dx > panelW * 0.4) {
                            // Animate out then close
                            if (panelElRef.current) {
                              panelElRef.current.style.transition = "transform 0.22s cubic-bezier(0.4,0,1,1)";
                              panelElRef.current.style.transform = `translateX(100%)`;
                            }
                            setTimeout(() => setArtifactsOpen(false), 220);
                          } else {
                            // Snap back
                            if (panelElRef.current) {
                              panelElRef.current.style.transition = "transform 0.28s cubic-bezier(0.16,1,0.3,1)";
                              panelElRef.current.style.transform = "";
                            }
                          }
                        } else {
                          if (panelElRef.current) {
                            panelElRef.current.style.transition = "transform 0.28s cubic-bezier(0.16,1,0.3,1)";
                            panelElRef.current.style.transform = "";
                          }
                        }
                      }
                      panelDragRef.current = null;
                      touchStartRef.current = null;
                      panelDraggingRef.current = false;
                    }}
                  >
                    {/* Left Border Draggable Resize Handle (Desktop/Tablet) */}
                    <div
                      className={`side-panel-resize-handle ${isResizingSidePanel ? "active" : ""}`}
                      onMouseDown={handleSidePanelResizeStart}
                      onTouchStart={handleSidePanelResizeStart}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSidePanelWidth(480);
                        try {
                          localStorage.setItem("porta:sidePanelWidth", "480");
                        } catch {}
                      }}
                      title="左右拖动调整面板宽度 (双击重置为 480px)"
                    >
                      <div className="side-panel-resize-indicator" />
                    </div>

                    <Suspense fallback={<div className="artifacts-loading"><IconSpinner className="icon-spin" /></div>}>
                      <SidePanel
                        key={`side-panel-${activeId || "empty"}`}
                        cascadeId={activeId}
                        steps={steps}
                        messages={optimisticMessages}
                        workspaceUri={currentWorkspaceUri}
                        projectName={projectSlug}
                        selectedFile={selectedFile}
                        activeSubagentId={activeSubagentId}
                        onSelectSubagent={handleSelectSubagent}
                        onClose={() => {
                          setArtifactsOpen(false);
                          setSelectedFile(null);
                        }}
                        initialTab={sidePanelTab}
                      />
                    </Suspense>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <ExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        title={headerTitle}
        cascadeId={activeId}
        initialMessages={stepsToMessages(steps)}
      />
    </div>
  );
}
