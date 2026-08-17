/**
 * Client for the locally installed cockpit-tools WebSocket service
 * (https://github.com/jlcodes99/cockpit-tools).
 *
 * cockpit-tools manages Antigravity (and other IDE) accounts and exposes a
 * local WebSocket service for plugins/clients. Protocol facts (v1.3.x):
 *
 *   - Endpoint: ws://127.0.0.1:<ws_port> — port & liveness live in
 *     ~/.antigravity_cockpit/server.json (written on startup; the port can
 *     drift upward if occupied).
 *   - Messages: {"type": "<name>", "payload": {...}} (serde tag/content).
 *   - On connect the server pushes {"type":"event.ready",...}.
 *   - Replies may be sent directly OR broadcast to every client, so responses
 *     are ALWAYS correlated by request_id — never by socket.
 *   - Local (loopback) connections are accepted without a token.
 *
 * This module deliberately opens a fresh connection per request: no
 * reconnect state machine, and a lost socket can never cancel a server-side
 * account switch (the switch task runs detached inside cockpit-tools).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { WebSocket } from "ws";
import { platformAdapter } from "./platform/index.js";
import { runCommand } from "./platform/shared.js";
import { launchAntigravity } from "./antigravity-launch.js";
import { writeAntigravityCredential } from "./win-credential.js";

const COCKPIT_DIR = join(homedir(), ".antigravity_cockpit");

export interface CockpitServerInfo {
  ws_port: number;
  version?: string;
  pid?: number;
  /** Session token required by high-risk WS operations (get_accounts_with_tokens). */
  auth_token?: string;
}

export interface CockpitAccount {
  id: string;
  email: string;
  name?: string;
  is_current: boolean;
  disabled: boolean;
  last_used: number;
  subscription_tier?: string;
}

export class CockpitError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_installed"
      | "disabled"
      | "unreachable"
      | "timeout"
      | "protocol"
      | "switch_failed",
  ) {
    super(message);
    this.name = "CockpitError";
  }
}

/** Read ~/.antigravity_cockpit/server.json → {ws_port}. */
export function readCockpitServerInfo(
  cockpitDir: string = COCKPIT_DIR,
): CockpitServerInfo {
  const serverFile = join(cockpitDir, "server.json");
  if (!existsSync(serverFile)) {
    throw new CockpitError(
      "cockpit-tools 未安装或从未运行（缺少 ~/.antigravity_cockpit/server.json）",
      "not_installed",
    );
  }
  try {
    const info = JSON.parse(readFileSync(serverFile, "utf-8"));
    const port = Number(info?.ws_port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("invalid ws_port");
    }
    return {
      ws_port: port,
      ...(typeof info.version === "string" ? { version: info.version } : {}),
      ...(Number.isInteger(info?.pid) ? { pid: info.pid } : {}),
      ...(typeof info?.auth_token === "string" && info.auth_token.trim()
        ? { auth_token: info.auth_token.trim() }
        : {}),
    };
  } catch (err) {
    if (err instanceof CockpitError) throw err;
    throw new CockpitError(
      `cockpit-tools server.json 解析失败: ${(err as Error).message}`,
      "not_installed",
    );
  }
}

/** Whether the cockpit WS service is enabled in its config.json. */
export function isCockpitWsEnabled(cockpitDir: string = COCKPIT_DIR): boolean {
  try {
    const config = JSON.parse(
      readFileSync(join(cockpitDir, "config.json"), "utf-8"),
    );
    return config?.ws_enabled !== false; // default on
  } catch {
    return true; // unreadable config → let the connection attempt decide
  }
}

interface CockpitEnvelope {
  type: string;
  payload?: Record<string, unknown>;
}

/**
 * Open a WS connection, send one request, wait for the response carrying the
 * same request_id. Rejects on timeout / close-before-response.
 */
export function cockpitRequest<T>(
  type: string,
  payload: Record<string, unknown> = {},
  opts: { timeoutMs?: number; serverInfo?: CockpitServerInfo } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let info: CockpitServerInfo;
  try {
    info = opts.serverInfo ?? readCockpitServerInfo();
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise<T>((resolve, reject) => {
    const request_id = randomUUID();
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${info.ws_port}`, {
        handshakeTimeout: Math.min(timeoutMs, 4_000),
      });
    } catch (err) {
      reject(
        new CockpitError(
          `无法连接 cockpit-tools: ${(err as Error).message}`,
          "unreachable",
        ),
      );
      return;
    }

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      try {
        ws.close();
      } catch {}
    };

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new CockpitError(
              `cockpit-tools 响应超时（${timeoutMs}ms）: ${type}`,
              "timeout",
            ),
          ),
        ),
      timeoutMs,
    );

    ws.on("open", () => {
      ws.send(JSON.stringify({ type, payload: { ...payload, request_id } }));
    });

    ws.on("message", (raw) => {
      let msg: CockpitEnvelope;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore non-JSON frames
      }
      if (msg?.payload?.request_id !== request_id) return;

      if (msg.type === "response.error") {
        finish(() =>
          reject(
            new CockpitError(String(msg.payload?.error ?? "未知错误"), "protocol"),
          ),
        );
      } else if (msg.type.startsWith("response.")) {
        finish(() => resolve(msg.payload as T));
      }
      // Other messages (events, ready, pong) are not ours to handle.
    });

    ws.on("error", (err) =>
      finish(() =>
        reject(
          new CockpitError(`无法连接 cockpit-tools: ${err.message}`, "unreachable"),
        ),
      ),
    );

    ws.on("close", () =>
      finish(() =>
        reject(
          new CockpitError("cockpit-tools 连接在响应前关闭", "unreachable"),
        ),
      ),
    );
  });
}

/** Quick liveness probe — get_current_account doubles as a version-safe ping. */
export async function cockpitStatus(): Promise<{
  connected: boolean;
  version?: string;
  wsPort?: number;
  error?: string;
  code?: string;
}> {
  try {
    const info = readCockpitServerInfo();
    if (!isCockpitWsEnabled()) {
      return {
        connected: false,
        wsPort: info.ws_port,
        error: "cockpit-tools 的 WebSocket 服务已在它的设置中关闭",
        code: "disabled",
      };
    }
    await cockpitRequest<unknown>("request.get_current_account", {}, {
      timeoutMs: 4_000,
    });
    return { connected: true, version: info.version, wsPort: info.ws_port };
  } catch (err) {
    return {
      connected: false,
      error: (err as Error).message,
      ...(err instanceof CockpitError ? { code: err.code } : {}),
    };
  }
}

interface AccountsResponse {
  accounts?: CockpitAccount[];
  current_account_id?: string | null;
}

export async function cockpitAccounts(): Promise<{
  accounts: CockpitAccount[];
  currentAccountId: string | null;
}> {
  const data = await cockpitRequest<AccountsResponse>("request.get_accounts");
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  return {
    accounts,
    currentAccountId: data.current_account_id ?? null,
  };
}

// ── Quota (per-model remaining percentages from cockpit's local cache) ──
//
// cockpit-tools persists each account's quota snapshot under
// ~/.antigravity_cockpit/cache/quota_api_v1_desktop/<source>/<sha256(email)>.json
// The WS protocol has no quota request and no refresh trigger — snapshots are
// written by cockpit's own periodic refresh (auto_refresh_minutes) and on
// account switches. We read the files directly and surface their updatedAt so
// the UI can show how fresh the numbers are.

export interface CockpitModelQuota {
  name: string;
  remainingPercent: number;
  resetTime?: string;
}

/** Group-level quota buckets (quota_summary.groups) — what cockpit's UI shows. */
export interface CockpitQuotaBucket {
  window: "weekly" | "5h" | string;
  remainingPercent: number;
  resetTime?: string;
}

export interface CockpitQuotaGroup {
  name: string;
  buckets: CockpitQuotaBucket[];
}

export interface CockpitQuota {
  /** Cache write time in epoch ms. */
  updatedAt: number;
  models: CockpitModelQuota[];
  /** Real usage lives here — per-model remainingFraction is a coarse bucket. */
  groups?: CockpitQuotaGroup[];
}

interface RawQuotaCacheFile {
  email?: string;
  updatedAt?: number;
  payload?: {
    models?: Record<
      string,
      {
        displayName?: string;
        quotaInfo?: {
          remainingFraction?: number;
          resetTime?: string;
        };
      }
    >;
  };
}

/** Normalize seconds/ms timestamps to ms. */
export function toEpochMs(value: number): number {
  return value > 1e12 ? value : value * 1000;
}

/**
 * Extract per-model quotas from a loadCodeAssist payload (shared by the
 * cache reader and the live fetcher). Multiple model keys can share a
 * displayName — dedupe by name keeping the LOWEST remaining percentage (the
 * conservative reading of "how much is left").
 */
export function extractModelQuotas(payload: {
  models?: Record<
    string,
    {
      displayName?: string;
      quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
      };
    }
  >;
}): CockpitModelQuota[] {
  const byName = new Map<string, CockpitModelQuota>();
  for (const model of Object.values(payload.models ?? {})) {
    if (!model?.displayName) continue;
    const fraction = model.quotaInfo?.remainingFraction;
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) continue;
    const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    const existing = byName.get(model.displayName);
    if (
      !existing ||
      percent < existing.remainingPercent ||
      (percent === existing.remainingPercent &&
        model.quotaInfo?.resetTime &&
        !existing.resetTime)
    ) {
      byName.set(model.displayName, {
        name: model.displayName,
        remainingPercent: percent,
        ...(model.quotaInfo?.resetTime
          ? { resetTime: model.quotaInfo.resetTime }
          : {}),
      });
    }
  }
  return [...byName.values()];
}

/**
 * Extract group-level quota buckets from a loadCodeAssist/fetchAvailableModels
 * payload (quota_summary.groups). This is the real usage signal — the
 * per-model remainingFraction is a coarse bucket that stays at 100% until
 * large thresholds are crossed.
 */
export function extractQuotaGroups(payload: {
  quota_summary?: {
    groups?: {
      displayName?: string;
      buckets?: {
        bucketId?: string;
        window?: string;
        remainingFraction?: number;
        resetTime?: string;
      }[];
    }[];
  };
}): CockpitQuotaGroup[] {
  return (payload.quota_summary?.groups ?? [])
    .filter((g) => (g.buckets?.length ?? 0) > 0)
    .map((g) => ({
      name: g.displayName ?? "模型组",
      buckets: (g.buckets ?? [])
        .filter((b) => typeof b.remainingFraction === "number")
        .map((b) => ({
          window: b.window ?? b.bucketId ?? "",
          remainingPercent: Math.max(
            0,
            Math.min(100, Math.round((b.remainingFraction as number) * 100)),
          ),
          ...(b.resetTime ? { resetTime: b.resetTime } : {}),
        })),
    }));
}

export function parseQuotaCacheEntry(raw: string): {
  email: string;
  quota: CockpitQuota;
} | null {
  let data: RawQuotaCacheFile;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const email = data.email?.trim().toLowerCase();
  if (!email) return null;
  if (!data.payload?.models) return null;

  return {
    email,
    quota: {
      updatedAt: toEpochMs(data.updatedAt ?? 0),
      models: extractModelQuotas(data.payload),
      groups: extractQuotaGroups(data.payload as never),
    },
  };
}

/** Read every quota cache snapshot, keyed by lowercase email. Latest wins. */
export function readCockpitQuotas(
  cockpitDir: string = COCKPIT_DIR,
): Map<string, CockpitQuota> {
  const result = new Map<string, CockpitQuota>();
  const cacheRoot = join(cockpitDir, "cache", "quota_api_v1_desktop");
  if (!existsSync(cacheRoot)) return result;

  let sources: string[];
  try {
    sources = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result;
  }

  for (const source of sources) {
    let files: string[];
    try {
      files = readdirSync(join(cacheRoot, source)).filter((f) =>
        f.endsWith(".json"),
      );
    } catch {
      continue;
    }
    for (const file of files) {
      let parsed: ReturnType<typeof parseQuotaCacheEntry>;
      try {
        parsed = parseQuotaCacheEntry(
          readFileSync(join(cacheRoot, source, file), "utf-8"),
        );
      } catch {
        continue;
      }
      if (!parsed) continue;
      const existing = result.get(parsed.email);
      if (!existing || parsed.quota.updatedAt > existing.updatedAt) {
        result.set(parsed.email, parsed.quota);
      }
    }
  }
  return result;
}

/**
 * Switch the active Antigravity account. cockpit-tools owns the full flow
 * (token rewrite + optional IDE restart / no-restart dual mode), which can
 * take a minute — hence the long timeout.
 */
export async function cockpitSwitchAccount(
  accountId: string,
): Promise<{ message: string }> {
  const data = await cockpitRequest<{ message?: string }>(
    "request.switch_account",
    { account_id: accountId },
    { timeoutMs: 120_000 },
  );
  return { message: data.message ?? "切换账号成功" };
}

// ── Live quota refresh (per-account, on demand) ──
//
// cockpit-tools' WS protocol has no quota-refresh request, and its snapshots
// only update every auto_refresh_minutes. To refresh ONE account we fetch
// directly from the same Google endpoint cockpit uses (loadCodeAssist) with
// that account's access token, obtained via the cockpit WS. Tokens never
// leave this module — the web client only ever sees parsed percentages.

interface CockpitTokenAccount {
  id: string;
  email: string;
  is_current: boolean;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  project_id?: string | null;
}

/** Fetch the account list WITH tokens. Sensitive — server-side only. */
export async function cockpitAccountsWithTokens(): Promise<
  CockpitTokenAccount[]
> {
  // High-risk operation — must present the session token from server.json.
  const info = readCockpitServerInfo();
  const data = await cockpitRequest<{
    accounts?: CockpitTokenAccount[];
  }>(
    "request.get_accounts_with_tokens",
    info.auth_token ? { auth_token: info.auth_token } : {},
  );
  return Array.isArray(data.accounts) ? data.accounts : [];
}

const QUOTA_BASE_URL =
  process.env.PORTA_QUOTA_BASE_URL ?? "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_PATH = "v1internal:loadCodeAssist";
const ONBOARD_USER_PATH = "v1internal:onboardUser";
const FETCH_AVAILABLE_MODELS_PATH = "v1internal:fetchAvailableModels";

function quotaUserAgent(): string {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch;
  return `antigravity/2.8.1 ${os}/${arch} google-api-nodejs-client/10.3.0`;
}

/** The API validates metadata.platform against this enum (per cockpit-tools). */
function cloudCodePlatformName(): string {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "DARWIN_ARM64" : "DARWIN_AMD64";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "LINUX_ARM64" : "LINUX_AMD64";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "PLATFORM_UNSPECIFIED" : "WINDOWS_AMD64";
  }
  return "PLATFORM_UNSPECIFIED";
}

function buildCloudCodeMetadata(projectId?: string | null): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ideName: "antigravity",
    ideType: "ANTIGRAVITY",
    ideVersion: "2.8.1",
    pluginVersion: "2.8.1",
    platform: cloudCodePlatformName(),
    updateChannel: "stable",
    pluginType: "GEMINI",
  };
  if (projectId && projectId.trim()) {
    metadata.duetProject = projectId.trim();
  }
  return metadata;
}

/** cloudaicompanionProject may arrive as a bare id string or as {id: "..."} . */
function extractProjectId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One authenticated call against the Cloud Code internal API. */
function cloudCodeCall(
  path: string,
  accessToken: string,
  body: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const serialized = body === null ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const url = new URL(`${QUOTA_BASE_URL}/${path}`);
    const req = httpsRequest(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: body === null ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === null
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(serialized),
              }),
          "User-Agent": quotaUserAgent(),
          "x-goog-api-client": "gl-node/22.21.1",
          Accept: "*/*",
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode !== 200) {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(
                new CockpitError(
                  "访问令牌已过期或无效，请在电脑端 cockpit-tools 中刷新该账号后重试",
                  "switch_failed",
                ),
              );
            } else {
              reject(
                new CockpitError(
                  `额度接口返回 ${res.statusCode}: ${text.slice(0, 200)}`,
                  "protocol",
                ),
              );
            }
            return;
          }
          try {
            resolve(JSON.parse(text) as Record<string, unknown>);
          } catch (err) {
            reject(
              new CockpitError(
                `额度响应解析失败: ${(err as Error).message}`,
                "protocol",
              ),
            );
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new CockpitError("额度接口请求超时", "timeout"));
    });
    req.on("error", (err) =>
      reject(new CockpitError(`额度接口请求失败: ${err.message}`, "unreachable")),
    );
    if (body !== null) req.write(serialized);
    req.end();
  });
}

function pickOnboardTier(
  tiers: unknown,
): string | undefined {
  if (!Array.isArray(tiers)) return undefined;
  const list = tiers as { id?: unknown; isDefault?: unknown }[];
  const def = list.find((t) => t.isDefault === true && typeof t.id === "string");
  if (def) return def.id as string;
  const first = list.find((t) => typeof t.id === "string" && t.id);
  if (first) return first.id as string;
  return list.length > 0 ? "LEGACY" : undefined;
}

export interface LiveQuotaResult {
  quota: CockpitQuota;
  tierId?: string;
  /** Raw loadCodeAssist payload (for the cockpit cache write-back). */
  payload: Record<string, unknown>;
  projectId?: string;
}

/**
 * Fetch live quota. Flow mirrors cockpit-tools:
 *   1. loadCodeAssist → resolve the cloudaicompanionProject (onboard if none)
 *      and the subscription tier.
 *   2. fetchAvailableModels with that project → per-model quotaInfo.
 * The fetchAvailableModels response is what cockpit caches, so it is also
 * used for the cache write-back.
 */
export async function fetchAntigravityQuota(
  accessToken: string,
  projectId?: string | null,
): Promise<LiveQuotaResult> {
  const load = (pid?: string) =>
    cloudCodeCall(LOAD_CODE_ASSIST_PATH, accessToken, {
      metadata: buildCloudCodeMetadata(pid),
      mode: "FULL_ELIGIBILITY_CHECK",
      ...(pid ? { cloudaicompanionProject: pid } : {}),
    });

  let loadPayload = await load(projectId ?? undefined);
  let resolvedProject =
    projectId ?? extractProjectId(loadPayload.cloudaicompanionProject);

  if (!resolvedProject) {
    const tierId = pickOnboardTier(loadPayload.allowedTiers);
    if (tierId) {
      // Long-running operation — poll until done, then read the project id.
      let op = await cloudCodeCall(ONBOARD_USER_PATH, accessToken, {
        tierId,
        metadata: buildCloudCodeMetadata(),
      });
      const deadline = Date.now() + 30_000;
      while (
        op.done !== true &&
        typeof op.name === "string" &&
        op.name.trim() &&
        Date.now() < deadline
      ) {
        await sleep(500);
        op = await cloudCodeCall(
          `v1internal/${op.name.trim()}`,
          accessToken,
          null,
        );
      }
      const onboardProject = extractProjectId(
        (op.response as { cloudaicompanionProject?: unknown } | undefined)
          ?.cloudaicompanionProject,
      );
      if (onboardProject) {
        resolvedProject = onboardProject;
        loadPayload = await load(onboardProject);
      }
    }
  }

  const tierId =
    ((loadPayload.paidTier as { id?: string } | undefined)?.id ??
      (loadPayload.currentTier as { id?: string } | undefined)?.id) ??
    undefined;

  const modelsPayload = await cloudCodeCall(
    FETCH_AVAILABLE_MODELS_PATH,
    accessToken,
    resolvedProject ? { project: resolvedProject } : {},
  );

  return {
    quota: {
      updatedAt: Date.now(),
      models: extractModelQuotas(modelsPayload as never),
      groups: extractQuotaGroups(modelsPayload as never),
    },
    ...(tierId ? { tierId } : {}),
    payload: modelsPayload,
    ...(resolvedProject ? { projectId: resolvedProject } : {}),
  };
}

function quotaEmailHash(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/**
 * Write a fresh snapshot into cockpit's quota cache (same file format) so
 * cockpit's own UI picks it up too. Best-effort — failure is non-fatal.
 */
export function writeQuotaCacheSnapshot(
  email: string,
  payload: Record<string, unknown>,
  projectId?: string | null,
  cockpitDir: string = COCKPIT_DIR,
): void {
  try {
    const dir = join(cockpitDir, "cache", "quota_api_v1_desktop", "authorized");
    mkdirSync(dir, { recursive: true });
    const record = {
      version: 1,
      source: "authorized",
      customSource: null,
      email,
      ...(projectId ? { projectId } : {}),
      updatedAt: Date.now(),
      payload,
    };
    const file = join(dir, `${quotaEmailHash(email)}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), "utf-8");
    renameSync(tmp, file);
  } catch {
    // Cache write-back is an optimization, never a failure mode.
  }
}

/**
 * Refresh one account's quota live: token lookup → loadCodeAssist →
 * cache write-back. Returns the parsed quota for the client.
 */
export async function cockpitRefreshAccountQuota(accountId: string): Promise<{
  email: string;
  quota: CockpitQuota;
  tierId?: string;
}> {
  const accounts = await cockpitAccountsWithTokens();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new CockpitError("账号不存在或令牌不可用", "protocol");
  }
  const result = await fetchAntigravityQuota(
    account.access_token,
    account.project_id,
  );
  writeQuotaCacheSnapshot(account.email, result.payload, result.projectId);
  return {
    email: account.email,
    quota: result.quota,
    ...(result.tierId ? { tierId: result.tierId } : {}),
  };
}

// ── Native account switch (Antigravity 2.x) ──
//
// cockpit ≤ v1.3.21 switches by injecting tokens into the legacy
// "Antigravity IDE" state.vscdb — which the new Antigravity 2.x app never
// reads (it uses the Windows Credential Manager entry "gemini:antigravity").
// So the proxy performs the real switch itself:
//   1. Write the target account's token to the Credential Manager.
//   2. Kill the running Antigravity processes.
//   3. Let cockpit's switch orchestrate the restart + its own bookkeeping
//      (current-account tracking); if that fails, relaunch directly.

/**
 * PIDs of the Antigravity app under EITHER exe name: the canonical
 * "Antigravity.exe" (our launcher bat) or the "antigravity-ide.exe"
 * hardlink cockpit-tools launches it through.
 */
export async function antigravityProcessPids(): Promise<number[]> {
  const [a, b] = await Promise.all([
    platformAdapter.findProcessPidsByName("Antigravity"),
    platformAdapter.findProcessPidsByName("antigravity-ide"),
  ]);
  return [...new Set([...a, ...b])];
}

export async function killAntigravityProcesses(): Promise<number> {
  const pids = await antigravityProcessPids();
  let killed = 0;
  for (const pid of pids) {
    try {
      await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"], 8000);
      killed++;
    } catch {
      // Process may have exited between listing and killing
    }
  }
  return killed;
}

export async function cockpitSwitchAccountNative(
  accountId: string,
): Promise<{ message: string }> {
  const accounts = await cockpitAccountsWithTokens();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new CockpitError("账号不存在或令牌不可用", "protocol");
  }

  // 1. Credential Manager first — the running app ignores it until restart.
  await writeAntigravityCredential({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expires_at: account.expires_at,
  });

  // 2. Kill the running app so the new credential takes effect on next boot.
  const killed = await killAntigravityProcesses();
  if (killed > 0) {
    await new Promise((r) => setTimeout(r, 1_500));
  }

  // 3. cockpit restarts the app (via its configured path) and updates its
  //    current-account bookkeeping. On failure, relaunch ourselves — the
  //    credential is already in place, so the switch still takes effect.
  try {
    const result = await cockpitSwitchAccount(accountId);
    return result;
  } catch (err) {
    console.warn(
      `cockpit switch orchestration failed after credential swap: ${(err as Error).message}`,
    );
    try {
      launchAntigravity(process.env);
      return { message: "已切换账号并重启（cockpit 状态同步失败）" };
    } catch {
      throw err;
    }
  }
}
