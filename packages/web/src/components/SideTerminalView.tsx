import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  IconTerminalSquare,
  IconPlus,
  IconChevron,
  IconX,
} from "./Icons";
import { resolveWsUrl } from "../api/client";

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

export interface SideTerminalViewProps {
  workspaceUri?: string;
  projectName?: string;
  onBack?: () => void;
  onClose?: () => void;
}

/** 嵌入式多标签终端 View (按需懒加载) */
export function SideTerminalView({
  workspaceUri,
  projectName,
  onBack,
  onClose,
}: SideTerminalViewProps) {
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

      const remaining = tabs.filter((t) => t.id !== tabIdToClose);
      if (remaining.length === 0) {
        if (onBack) onBack();
        else if (onClose) onClose();
        counterRef.current = 1;
        setTabs([]);
        setActiveTabId("");
        return;
      }

      setTabs(remaining);
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
    },
    [tabs, activeTabId, onBack, onClose],
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

  // Clean up all terminal instances on unmount
  useEffect(() => {
    return () => {
      instancesRef.current.forEach((inst) => {
        try {
          inst.ws.close();
          inst.term.dispose();
          inst.container.remove();
        } catch {}
      });
      instancesRef.current.clear();
    };
  }, []);

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
            <button className="zcode-panel-tool-btn" onClick={onClose} title="关闭侧边栏">
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="zcode-terminal-dock-body" ref={dockBodyRef} />
    </div>
  );
}

export default SideTerminalView;
