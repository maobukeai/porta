/**
 * Interactive PTY terminal WebSocket handler.
 * Supports:
 * 1. Native pseudo-terminal via node-pty (with ANSI color, tabs, full PTY emulation).
 * 2. Official Language Server terminal stream bridge (CreateTerminal / StreamTerminalOutput / SendTerminalInput / CloseTerminal).
 */

import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { discovery, rpcAny } from "./routing.js";

function resolvePathFromUri(uri?: string): string {
  if (!uri) return process.cwd();
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      const stripped = uri.replace(/^file:\/\/\/?/, "");
      return process.platform === "win32" ? stripped.replace(/\//g, "\\") : stripped;
    }
  }
  return uri;
}

export function makeConnectEnvelope(payload: Record<string, unknown>): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0); // flags: 0
  header.writeUInt32BE(jsonBuf.length, 1); // 4-byte big-endian message length
  return Buffer.concat([header, jsonBuf]);
}

/**
 * Bridge WebSocket to official Language Server terminal stream.
 */
async function bridgeLsTerminal(
  ws: WebSocket,
  _cols: number,
  _rows: number,
): Promise<boolean> {
  try {
    const ls = await discovery.getInstance();
    if (!ls) return false;

    const createRes = await rpcAny<{
      terminal?: { terminalId: string; pid?: number; title?: string };
    }>("CreateTerminal", {});

    const terminalId = createRes?.terminal?.terminalId;
    if (!terminalId) return false;

    const useTls = (ls.httpsPort ?? 0) > 0;
    const port = useTls ? ls.httpsPort : ls.httpPort;
    const requestFn = useTls ? httpsRequest : httpRequest;

    const streamReq = requestFn(
      {
        hostname: "127.0.0.1",
        port,
        path: "/exa.language_server_pb.LanguageServerService/StreamTerminalOutput",
        method: "POST",
        headers: {
          "Content-Type": "application/connect+json",
          "Connect-Protocol-Version": "1",
          "x-codeium-csrf-token": ls.csrfToken,
        },
        rejectUnauthorized: false,
      },
      (streamRes) => {
        let streamBuf = Buffer.alloc(0);
        streamRes.on("data", (chunk: Buffer) => {
          streamBuf = Buffer.concat([streamBuf, chunk]);
          while (streamBuf.length >= 5) {
            const msgLen = streamBuf.readUInt32BE(1);
            if (streamBuf.length < 5 + msgLen) break;
            const msgBuf = streamBuf.subarray(5, 5 + msgLen);
            streamBuf = streamBuf.subarray(5 + msgLen);
            try {
              const parsed = JSON.parse(msgBuf.toString("utf8"));
              if (parsed.output) {
                const decoded = Buffer.from(parsed.output, "base64").toString("utf8");
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "output", data: decoded }));
                }
              }
            } catch {}
          }
        });

        streamRes.on("end", () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "output",
                data: `\r\n\x1b[90m[Language Server 终端已退出]\x1b[0m\r\n`,
              }),
            );
            ws.close();
          }
        });
      },
    );

    streamReq.on("error", (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "output",
            data: `\r\n\x1b[31mLS 终端通信异常: ${err.message}\x1b[0m\r\n`,
          }),
        );
      }
    });

    streamReq.write(makeConnectEnvelope({ terminalId }));
    streamReq.end();

    const cleanup = () => {
      try {
        streamReq.destroy();
      } catch {}
      rpcAny("CloseTerminal", { terminalId }).catch(() => {});
    };

    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "input" && typeof msg.data === "string") {
          rpcAny("SendTerminalInput", {
            terminalId,
            input: Buffer.from(msg.data, "utf8").toString("base64"),
          }).catch(() => {});
        } else if (msg.type === "restart") {
          cleanup();
          void bridgeLsTerminal(ws, _cols, _rows);
        }
      } catch {
        rpcAny("SendTerminalInput", {
          terminalId,
          input: Buffer.from(raw.toString(), "utf8").toString("base64"),
        }).catch(() => {});
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    return true;
  } catch {
    return false;
  }
}

export function handleTerminalWebSocket(ws: WebSocket, req: IncomingMessage, port: number): void {
  const url = new URL(req.url ?? "", `http://localhost:${port}`);
  const requestedCwd = url.searchParams.get("cwd") || "";
  const workspaceUri = url.searchParams.get("workspaceUri") || "";
  const cols = parseInt(url.searchParams.get("cols") || "120", 10);
  const rows = parseInt(url.searchParams.get("rows") || "30", 10);
  const preferLs = url.searchParams.get("mode") === "ls" || url.searchParams.get("useLs") === "true";

  let initialCwd = requestedCwd || resolvePathFromUri(workspaceUri) || process.cwd();
  if (!existsSync(initialCwd)) {
    initialCwd = process.cwd();
  }

  const runLocalPty = () => {
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

        proc.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "output", data }));
          }
        });

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
        return null;
      }
    };

    ptyProcess = spawnPty();
    if (!ptyProcess) {
      // Graceful fallback to Language Server terminal streaming
      void bridgeLsTerminal(ws, cols, rows).then((ok) => {
        if (!ok && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "output",
            data: `\r\n\x1b[31m无法启动本地或 Language Server 终端进程\x1b[0m\r\n`,
          }));
          ws.close();
        }
      });
      return;
    }

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
  };

  if (preferLs) {
    void bridgeLsTerminal(ws, cols, rows).then((ok) => {
      if (!ok) {
        runLocalPty();
      }
    });
    return;
  }

  runLocalPty();
}
