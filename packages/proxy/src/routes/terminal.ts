/**
 * /api/terminal route — interactive web shell execution and terminal dock backend
 */

import type { Hono } from "hono";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

function resolvePathFromUri(uri?: string): string {
  if (!uri) return process.cwd();
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri.replace(/^file:\/\/\/?/, "").replace(/\//g, "\\");
    }
  }
  return uri;
}

function executeShell(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult) => {
    const isWindows = process.platform === "win32";
    let child;

    if (isWindows) {
      // Execute via PowerShell with UTF-8 encoding configuration
      const psCommand = `[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; & { ${command} }`;
      child = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
        {
          cwd,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            LANG: "zh_CN.UTF-8",
            LC_ALL: "zh_CN.UTF-8",
          },
          windowsHide: true,
        },
      );
    } else {
      child = spawn("/bin/bash", ["-c", command], {
        cwd,
        env: {
          ...process.env,
          LANG: "zh_CN.UTF-8",
          LC_ALL: "zh_CN.UTF-8",
        },
      });
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    // Close stdin so non-interactive execution returns immediately and doesn't block indefinitely
    try {
      child.stdin?.end();
    } catch {}

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolveResult({
        stdout,
        stderr: stderr || "命令执行超时 (30s)",
        exitCode: 124,
      });
    }, 30000);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolveResult({
        stdout,
        stderr: err.message || "进程启动失败",
        exitCode: 1,
      });
    });
  });
}

export function registerTerminalRoutes(app: Hono): void {
  // 1. GET /api/terminal/info
  app.get("/api/terminal/info", (c) => {
    const isWindows = process.platform === "win32";
    return c.json({
      shell: isWindows ? "PowerShell" : "bash",
      platform: process.platform,
      defaultCwd: process.cwd(),
      banner: isWindows
        ? "Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n"
        : "Linux / macOS Shell\n",
    });
  });

  // 2. POST /api/terminal/exec
  app.post("/api/terminal/exec", async (c) => {
    try {
      const body = await c.req.json<{ command: string; cwd?: string; workspaceUri?: string }>();
      const rawCommand = (body.command || "").trim();
      let targetCwd = body.cwd || resolvePathFromUri(body.workspaceUri) || process.cwd();

      if (!existsSync(targetCwd)) {
        targetCwd = process.cwd();
      }

      if (!rawCommand) {
        return c.json({ stdout: "", stderr: "", exitCode: 0, cwd: targetCwd });
      }

      // Handle drive switches (e.g., `D:` or `C:`)
      const driveMatch = rawCommand.match(/^([a-zA-Z]):$/);
      if (driveMatch) {
        const targetDrive = `${driveMatch[1].toUpperCase()}:\\`;
        if (existsSync(targetDrive)) {
          return c.json({ stdout: "", stderr: "", exitCode: 0, cwd: targetDrive });
        } else {
          return c.json({ stdout: "", stderr: `系统找不到指定的驱动器: ${targetDrive}`, exitCode: 1, cwd: targetCwd });
        }
      }

      // Handle `cd` navigation
      const cdMatch = rawCommand.match(/^cd(?:\s+(.*))?$/i);
      if (cdMatch) {
        const dest = (cdMatch[1] || "").trim().replace(/^["']|["']$/g, "");
        if (!dest || dest === "~") {
          const homeDir = process.env.USERPROFILE || process.env.HOME || process.cwd();
          return c.json({ stdout: "", stderr: "", exitCode: 0, cwd: homeDir });
        }

        let newDir = isAbsolute(dest) ? dest : resolve(targetCwd, dest);
        if (existsSync(newDir)) {
          try {
            if (statSync(newDir).isDirectory()) {
              return c.json({ stdout: "", stderr: "", exitCode: 0, cwd: newDir });
            } else {
              return c.json({ stdout: "", stderr: `“${newDir}”不是目录。`, exitCode: 1, cwd: targetCwd });
            }
          } catch (e) {
            return c.json({ stdout: "", stderr: (e as Error).message, exitCode: 1, cwd: targetCwd });
          }
        } else {
          return c.json({
            stdout: "",
            stderr: `找不到路径“${newDir}”，因为该路径不存在。`,
            exitCode: 1,
            cwd: targetCwd,
          });
        }
      }

      // Execute command in the active directory
      const result = await executeShell(rawCommand, targetCwd);

      return c.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cwd: targetCwd,
      });
    } catch (err) {
      return c.json(
        {
          stdout: "",
          stderr: (err as Error).message || "执行命令出错",
          exitCode: 1,
          cwd: process.cwd(),
        },
        500,
      );
    }
  });
}
