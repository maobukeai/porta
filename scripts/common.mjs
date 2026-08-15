import { execSync, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import os, { EOL } from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";

export function freePort(port) {
  if (!port) return;
  if (isWindows) {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const lines = output.trim().split(/\r?\n/);
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].includes(`:${port}`) && parts[3] === "LISTENING") {
          const pid = parseInt(parts[4], 10);
          if (pid && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {}
      }
    } catch {}
  } else {
    try {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
    } catch {}
  }
}

export function getLocalLanIps() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (lower.includes("virtual") || lower.includes("vethernet") || lower.includes("loopback")) {
      continue;
    }
    for (const net of nets[name] || []) {
      const familyV4 = typeof net.family === "string" ? net.family === "IPv4" : net.family === 4;
      if (familyV4 && !net.internal) {
        const ip = net.address;
        const [a, b] = ip.split(".").map(Number);
        if (a === 192 && b === 168) {
          results.unshift(ip);
        } else if (a === 10 || (a === 172 && b >= 16 && b <= 31)) {
          results.push(ip);
        } else {
          results.push(ip);
        }
      }
    }
  }
  return [...new Set(results)];
}

export function commandName(base) {
  return isWindows ? `${base}.cmd` : base;
}

export function ensureLogsDir() {
  const dir = path.resolve("logs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripInlineComment(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "\\" && quote === '"') {
      index += 1;
      continue;
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (
      char === "#" &&
      !quote &&
      (index === 0 || /\s/.test(value[index - 1]))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

export function loadEnvFile(filePath = ".env") {
  const absPath = path.resolve(filePath);
  if (!existsSync(absPath)) return;

  const contents = readFileSync(absPath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    const value = unquote(stripInlineComment(line.slice(separator + 1).trim()));

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function spawnLoggedProcess(
  label,
  command,
  args,
  logFile,
  extraEnv = {},
) {
  const shellCmd = [command, ...args].join(" ");
  const child = spawn(shellCmd, [], {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: true,
  });
  const logStream = createWriteStream(logFile, { flags: "a" });

  if (child.stdout) {
    child.stdout.pipe(logStream);
  }
  if (child.stderr) {
    child.stderr.pipe(logStream);
  }

  child.on("error", (err) => {
    logStream.write(`[${label}] failed to start: ${err.message}${EOL}`);
  });

  return { child, logStream };
}

export async function terminateChild(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(`taskkill /pid ${child.pid} /t /f`, [], {
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      });
      killer.on("error", resolve);
      killer.on("exit", resolve);
    });
    return;
  }

  child.kill("SIGTERM");
}

export function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
