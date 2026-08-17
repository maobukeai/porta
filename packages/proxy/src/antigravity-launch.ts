/**
 * Antigravity IDE relaunch support.
 *
 * The Language Server is a child process of the Antigravity IDE and dies with
 * it, which kills every proxy RPC ("No LS instances available"). This module
 * remembers how Antigravity was installed while it runs so the diagnostics
 * page can relaunch it remotely.
 *
 * Launch method resolution order (first configured wins):
 *   1. PORTA_ANTIGRAVITY_LAUNCH_BAT — path to a launcher script (e.g. a .bat
 *      that starts Antigravity with --proxy-server=http://127.0.0.1:7890).
 *      This is how the user normally starts Antigravity, so remote relaunch
 *      must reuse the same script.
 *   2. PORTA_ANTIGRAVITY_ARGS — extra CLI args appended to the IDE exe
 *      (e.g. "--proxy-server=http://127.0.0.1:7890").
 *   3. Plain spawn of the detected Antigravity executable.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";

const LAST_SEEN_FILE = join(
  homedir(),
  ".gemini",
  "antigravity",
  "porta_last_seen.json",
);

interface LastSeenState {
  idePath: string | null;
  lsPath: string | null;
  updatedAt: string;
}

export type LaunchPlan =
  | { kind: "bat"; batPath: string }
  | { kind: "exe"; exePath: string; args: string[] };

export type IdePathResolution =
  | { path: string; source: "env" | "last-seen" | "default" }
  | { path: null; source: "none" };

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

/**
 * Derive the IDE executable from a language_server executable path.
 * Standard layout: <install-root>/resources/bin/language_server.exe
 * → <install-root>/Antigravity.exe (Windows) or "antigravity" (Unix).
 * Fallback for <root>/bin/language_server layouts: two levels up.
 */
export function deriveIdePathFromLsPath(lsPath: string): string | null {
  const normalized = normalize(lsPath);
  const marker = `${sep}resources${sep}bin${sep}`;
  const idx = normalized.lastIndexOf(marker);
  const root =
    idx >= 0
      ? normalized.slice(0, idx)
      : dirname(dirname(normalized));

  if (!root) return null;
  return process.platform === "win32"
    ? join(root, "Antigravity.exe")
    : join(root, "antigravity");
}

/** Split an args string on whitespace, honoring double-quoted segments. */
export function splitArgs(raw: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    args.push(m[1] ?? m[2] ?? m[3]);
  }
  return args.filter((a) => a.length > 0);
}

/** Common install locations when nothing was persisted yet. */
export function defaultIdePathCandidates(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    return [
      join(home, "AppData", "Local", "Programs", "antigravity", "Antigravity.exe"),
      join(home, "AppData", "Local", "Programs", "antigravity-ide", "Antigravity.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Antigravity.app"];
  }
  return ["/usr/share/antigravity/antigravity", "/opt/antigravity/antigravity"];
}

function loadLastSeen(): LastSeenState | null {
  if (isTestRuntime() || !existsSync(LAST_SEEN_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(LAST_SEEN_FILE, "utf-8"));
    if (parsed && typeof parsed === "object") {
      return parsed as LastSeenState;
    }
  } catch {}
  return null;
}

let lastPersistedLsPath: string | null = null;

/** Persist the last-seen executable paths while Antigravity runs. */
export function rememberLsPath(lsPath: string): void {
  if (isTestRuntime() || lsPath === lastPersistedLsPath) return;
  lastPersistedLsPath = lsPath;
  const idePath = deriveIdePathFromLsPath(lsPath);
  const state: LastSeenState = {
    idePath: idePath ?? null,
    lsPath,
    updatedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(LAST_SEEN_FILE), { recursive: true });
    const tmp = `${LAST_SEEN_FILE}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    renameSync(tmp, LAST_SEEN_FILE);
  } catch {
    // Persistence is best-effort — default-path probing still works.
  }
}

/**
 * Resolve the IDE executable: env override → persisted last-seen →
 * default install locations. Only existing paths are returned.
 */
export function resolveIdePath(
  env: NodeJS.ProcessEnv = process.env,
): IdePathResolution {
  const override = env.PORTA_ANTIGRAVITY_EXE?.trim();
  if (override && existsSync(override)) {
    return { path: override, source: "env" };
  }

  const lastSeen = loadLastSeen();
  if (lastSeen?.idePath && existsSync(lastSeen.idePath)) {
    return { path: lastSeen.idePath, source: "last-seen" };
  }

  for (const candidate of defaultIdePathCandidates()) {
    if (existsSync(candidate)) {
      return { path: candidate, source: "default" };
    }
  }

  return { path: null, source: "none" };
}

/**
 * Decide how Antigravity will be launched. Throws when no usable method
 * exists (no bat configured, no IDE executable found).
 */
export function resolveLaunchPlan(
  env: NodeJS.ProcessEnv = process.env,
): LaunchPlan {
  const batPath = env.PORTA_ANTIGRAVITY_LAUNCH_BAT?.trim();
  if (batPath && existsSync(batPath)) {
    return { kind: "bat", batPath };
  }

  const ide = resolveIdePath(env);
  if (!ide.path) {
    throw new Error(
      "Cannot determine how to launch Antigravity: no PORTA_ANTIGRAVITY_LAUNCH_BAT configured and no Antigravity executable found",
    );
  }

  const rawArgs = env.PORTA_ANTIGRAVITY_ARGS?.trim();
  return { kind: "exe", exePath: ide.path, args: rawArgs ? splitArgs(rawArgs) : [] };
}

export interface LaunchResult {
  method: "bat" | "exe";
  command: string;
}

/** Launch Antigravity detached so it survives the proxy process. */
export function launchAntigravity(
  env: NodeJS.ProcessEnv = process.env,
): LaunchResult {
  const plan = resolveLaunchPlan(env);

  if (plan.kind === "bat") {
    // .bat files cannot be spawned directly on Windows — go through cmd.
    // The script is expected to `start` the GUI itself (see user's
    // 启动Antigravity_使用代理.bat), so cmd exits immediately.
    const cmd = env.ComSpec ?? "cmd.exe";
    spawn(cmd, ["/d", "/s", "/c", plan.batPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return { method: "bat", command: plan.batPath };
  }

  if (process.platform === "darwin" && plan.exePath.endsWith(".app")) {
    spawn("open", ["-a", plan.exePath, ...plan.args], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return { method: "exe", command: `open -a ${plan.exePath}` };
  }

  spawn(plan.exePath, plan.args, {
    detached: true,
    stdio: "ignore",
  }).unref();
  return {
    method: "exe",
    command: [plan.exePath, ...plan.args].join(" "),
  };
}
