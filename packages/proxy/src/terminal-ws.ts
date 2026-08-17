/**
 * Real interactive PTY terminal WebSocket handler via node-pty.
 * Uses a true pseudo-terminal so xterm.js works with full ANSI support,
 * proper key input, tab completion, coloring, and interactive CLIs.
 */

import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";

function resolvePathFromUri(uri?: string): string {
  if (!uri) return process.cwd();
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      // Only flip slashes to backslashes on Windows — POSIX paths must keep "/".
      const stripped = uri.replace(/^file:\/\/\/?/, "");
      return process.platform === "win32" ? stripped.replace(/\//g, "\\") : stripped;
    }
  }
  return uri;
}

export function handleTerminalWebSocket(ws: WebSocket, req: IncomingMessage, port: number): void {
  const url = new URL(req.url ?? "", `http://localhost:${port}`);
  const requestedCwd = url.searchParams.get("cwd") || "";
  const workspaceUri = url.searchParams.get("workspaceUri") || "";
  const cols = parseInt(url.searchParams.get("cols") || "120", 10);
  const rows = parseInt(url.searchParams.get("rows") || "30", 10);

  let initialCwd = requestedCwd || resolvePathFromUri(workspaceUri) || process.cwd();
  if (!existsSync(initialCwd)) {
    initialCwd = process.cwd();
  }

  const isWindows = process.platform === "win32";

  const shell = isWindows ? "powershell.exe" : (process.env.SHELL ?? "/bin/bash");
  const args = isWindows ? ["-NoLogo", "-ExecutionPolicy", "Bypass"] : [];

  let ptyProcess: pty.IPty | null = null;

  const spawnPty = (): pty.IPty | null => {
    try {
      const proc = pty.spawn(shell, args, {
        name: "xterm-256color",
        cols: isNaN(cols) ? 120 : cols,
        rows: isNaN(rows) ? 30 : rows,
        cwd: initialCwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: "zh_CN.UTF-8",
          LC_ALL: "zh_CN.UTF-8",
          PYTHONIOENCODING: "utf-8",
        } as Record<string, string>,
      });

      // PTY → WebSocket: forward all terminal output as ANSI
      proc.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data }));
        }
      });

      // PTY exit → notify client. When another process has already replaced
      // this one (restart), the exit belongs to the old shell — stay silent.
      proc.onExit(({ exitCode }) => {
        if (ptyProcess !== proc) return;
        ptyProcess = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "output",
            data: `\r\n\x1b[90m[进程已退出 (代码 ${exitCode ?? 0})]\x1b[0m\r\n`,
          }));
          ws.close();
        }
      });

      return proc;
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "output",
          data: `\r\n\x1b[31m无法启动终端进程: ${(err as Error).message}\x1b[0m\r\n`,
        }));
        ws.close();
      }
      return null;
    }
  };

  ptyProcess = spawnPty();
  if (!ptyProcess) return;

  // WebSocket → PTY: forward keystrokes and resize events
  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        ptyProcess?.write(msg.data);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        try {
          ptyProcess?.resize(msg.cols, msg.rows);
        } catch {}
      } else if (msg.type === "restart") {
        // Kill the current shell and spawn a fresh one on the same socket.
        try {
          ptyProcess?.kill();
        } catch {}
        ptyProcess = spawnPty();
        if (ptyProcess && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "output",
            data: "\r\n\x1b[90m[终端已重启]\x1b[0m\r\n",
          }));
        }
      }
    } catch {
      // Raw input fallback
      try {
        ptyProcess?.write(raw.toString());
      } catch {}
    }
  });

  const cleanup = () => {
    try {
      ptyProcess?.kill();
    } catch {}
    ptyProcess = null;
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
