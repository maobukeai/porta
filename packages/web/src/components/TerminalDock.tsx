import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { IconPlus, IconX } from "./Icons";
import { resolveWsUrl } from "../api/client";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspaceUri?: string;
  projectName?: string;
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

export function TerminalDock({ isOpen, onClose, workspaceUri, projectName }: Props) {
  const [height, setHeight] = useState<number>(240);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const dockBodyRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());

  const [tabs, setTabs] = useState<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const counterRef = useRef(1);

  // Resize drag handle logic
  const startResizing = useCallback((clientY: number) => {
    isDraggingRef.current = true;
    startYRef.current = clientY;
    startHeightRef.current = height;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveClientY: number) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - moveClientY;
      const maxH = Math.min(window.innerHeight * 0.85, 850);
      const minH = 120;
      const nextH = Math.max(minH, Math.min(maxH, startHeightRef.current + delta));
      setHeight(nextH);
      const activeInst = instancesRef.current.get(activeTabId);
      activeInst?.fitAddon.fit();
    };

    const handleMouseMove = (e: MouseEvent) => {
      onPointerMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        onPointerMove(e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
      const activeInst = instancesRef.current.get(activeTabId);
      activeInst?.fitAddon.fit();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);
  }, [height, activeTabId]);

  // Create a new terminal tab and instance
  const createNewTab = useCallback(() => {
    if (!dockBodyRef.current) return;

    const baseTitle = projectName || "终端";
    const currentCount = counterRef.current;
    const tabTitle = currentCount === 1 ? baseTitle : `${baseTitle} ${currentCount}`;
    counterRef.current += 1;

    const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create container element
    const container = document.createElement("div");
    container.className = "zcode-terminal-instance-container";
    container.id = `term-container-${tabId}`;
    dockBodyRef.current.appendChild(container);

    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
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
    fitAddon.fit();

    // Build WS URL
    const initialCols = term.cols || 120;
    const initialRows = term.rows || 30;
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

    // Hide others and show new
    instancesRef.current.forEach((inst, id) => {
      inst.container.style.display = id === tabId ? "block" : "none";
    });

    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 60);
  }, [projectName, workspaceUri]);

  // Switch tab
  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    instancesRef.current.forEach((inst, id) => {
      inst.container.style.display = id === tabId ? "block" : "none";
    });
    const targetInst = instancesRef.current.get(tabId);
    if (targetInst) {
      setTimeout(() => {
        targetInst.fitAddon.fit();
        targetInst.term.focus();
      }, 30);
    }
  }, []);

  // Close single tab
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
          // If no tabs remain, close the whole terminal dock!
          onClose();
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
              nextInst.fitAddon.fit();
              nextInst.term.focus();
            }, 30);
          }
        }
        return remaining;
      });
    },
    [activeTabId, onClose],
  );

  // Initialize first tab when terminal is opened
  useEffect(() => {
    if (isOpen) {
      if (instancesRef.current.size === 0) {
        const timer = setTimeout(() => {
          createNewTab();
        }, 50);
        return () => clearTimeout(timer);
      } else {
        // Just fit and focus current active tab
        const activeInst = instancesRef.current.get(activeTabId);
        if (activeInst) {
          setTimeout(() => {
            activeInst.fitAddon.fit();
            activeInst.term.focus();
          }, 50);
        }
      }
    }
  }, [isOpen, activeTabId, createNewTab]);

  // Window resize listener
  useEffect(() => {
    const handleWindowResize = () => {
      if (isOpen && activeTabId) {
        const inst = instancesRef.current.get(activeTabId);
        inst?.fitAddon.fit();
      }
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isOpen, activeTabId]);

  // Handle Height change
  useEffect(() => {
    if (isOpen && activeTabId) {
      const inst = instancesRef.current.get(activeTabId);
      setTimeout(() => {
        inst?.fitAddon.fit();
      }, 30);
    }
  }, [height, isOpen, activeTabId]);

  if (!isOpen) return null;

  const shell = navigator.userAgent.includes("Windows") ? "PowerShell" : "bash";

  return (
    <div
      className="zcode-terminal-dock"
      style={{ height: `${height}px` }}
    >
      {/* Top draggable resize handle */}
      <div
        className="zcode-terminal-resize-handle"
        onMouseDown={(e) => {
          e.preventDefault();
          startResizing(e.clientY);
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            startResizing(e.touches[0].clientY);
          }
        }}
        title="上下拖动调整终端高度"
      >
        <div className="zcode-terminal-resize-bar" />
      </div>

      {/* Header bar matching exact screenshot */}
      <div className="zcode-terminal-header">
        <div className="zcode-terminal-header-left">
          <span className="zcode-terminal-title">终端</span>
          <span className="zcode-terminal-shell-badge">{shell}</span>

          {/* Dynamic Tabs */}
          <div className="zcode-terminal-tab-list">
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

        <div className="zcode-terminal-header-right">
          <button
            className="zcode-terminal-action-btn"
            onClick={createNewTab}
            title="新建终端"
            type="button"
          >
            <IconPlus size={14} />
          </button>
          <button
            className="zcode-terminal-action-btn"
            onClick={onClose}
            title="关闭终端窗口"
            type="button"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>

      {/* Terminal Viewports Container */}
      <div
        className="zcode-terminal-xterm-container"
        ref={dockBodyRef}
        onClick={() => {
          const inst = instancesRef.current.get(activeTabId);
          inst?.term.focus();
        }}
      />
    </div>
  );
}
