import { useState, useCallback, useEffect, useRef } from "react";
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
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { QuickSwitchSheet } from "./components/QuickSwitchSheet";
import { IconFolder, IconGemini } from "./components/Icons";
import { useConversations } from "./hooks/useConversations";
import { usePolling } from "./hooks/usePolling";
import { useWorkspaces, slugFromUri } from "./hooks/useWorkspaces";
import { useDraftText } from "./hooks/useDraftText";
import { useChatActions } from "./hooks/useChatActions";
import { useClientSettings } from "./hooks/useClientSettings";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { api } from "./api/client";
import { isUnconfirmedOptimisticMessage } from "./utils/optimisticMessages";
import type { AskQuestionEntry, HealthResponse, MediaAttachment } from "./types";
import type { PlannerType } from "./components/ChatInput";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/:projectSlug/settings" element={<ChatView />} />
      <Route path="/:projectSlug" element={<ChatView />} />
      <Route path="/:projectSlug/:chatId" element={<ChatView />} />
    </Routes>
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
  return null; // Loading…
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
  const isMobile = () => window.innerWidth <= 480;
  const { conversations, loading, refresh, optimisticRemove } = useConversations(15_000);
  const { data: health } = usePolling<HealthResponse>(api.health, 30_000);

  // ── Hooks ──
  const { workspaces, currentWorkspaceUri } = useWorkspaces(
    conversations,
    projectSlug,
  );
  const { draftText, handleDraftChange } = useDraftText(activeId);
  const { settings, updateSettings } = useClientSettings();
  useVisualViewport();

  // ── Global Theme Application ──
  useEffect(() => {
    const currentTheme = settings.theme ?? "system";
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

  // Wire handleRevert to also update draft text
  const handleRevert = useCallback(
    async (stepIndex: number, draftContent?: string) => {
      await rawHandleRevert(stepIndex, draftContent);
      if (draftContent) {
        handleDraftChange(draftContent);
      }
    },
    [rawHandleRevert, handleDraftChange],
  );

  // ── Send: always grant file access ──
  const handleSend = useCallback(
    async (
      text: string,
      model: string | null,
      media?: MediaAttachment[],
      plannerType?: PlannerType,
    ) => {
      doSend(text, model, media, plannerType, true);
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
  const handleNew = useCallback((workspaceUri?: string) => {
    if (workspaceUri) {
      navigate(`/${slugFromUri(workspaceUri)}`);
    } else {
      navigate(`/${projectSlug ?? "unknown"}`);
    }
    setOptimisticMessages([]);
    if (isMobile()) setSidebarOpen(false);
  }, [navigate, projectSlug, setOptimisticMessages]);

  // Header info
  const headerTitle = activeId
    ? (activeConv?.summary.summary ?? "会话")
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
      {/* Mobile backdrop: tap to close sidebar */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="main-panel">
        <ChatHeader
          title={headerTitle}
          projectName={projectSlug ?? undefined}
          onMenuToggle={() => setSidebarOpen(true)}
          onQuickSwitch={() => setQuickSwitchOpen(true)}
          onNewChat={handleNew}
          onOpenSettings={() => {
            navigate(`/${projectSlug ?? "unknown"}/settings`);
            if (isMobile()) setSidebarOpen(false);
          }}
        />

        {/* Mobile Quick Switch Bottom Drawer */}
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
        {isSettingsPage ? (
          <SettingsPanel
            settings={settings}
            onUpdate={updateSettings}
            onBack={() => navigate(`/${projectSlug ?? "unknown"}`)}
          />
        ) : activeId ? (
          <ChatPanel
            key={activeId}
            cascadeId={activeId}
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
            onSidebarRefresh={refresh}
          />
        ) : (
          <div
            className="chat-area"
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
                <div className="chat-empty-badge">
                  <IconGemini size={28} />
                </div>
                <h1 className="chat-empty-title">你想在代码中构建什么？</h1>
                <p className="chat-empty-subtitle">
                  从分析项目、重构界面、开发新特性到智能调试，AI 协助全流程开发
                </p>
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
                    <IconFolder size={13} /> {projectSlug ?? "其他"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!isSettingsPage && (
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isRunning={isRunning}
            disabled={!connected}
            draft={draftText}
            onDraftChange={handleDraftChange}
            defaultModel={settings.defaultModel}
            defaultPlannerType={settings.defaultPlannerType}
          />
        )}
      </div>
    </div>
  );
}
