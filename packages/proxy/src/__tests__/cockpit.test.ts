import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted fakes (vi.mock factories are hoisted above everything else) ──

const { mockFiles, calls, FakeWebSocket, httpsState } = vi.hoisted(() => {
  const mockFiles: Record<string, string> = {};
  const calls: {
    url: string;
    sent: string[];
    reply: (type: string, payload: Record<string, unknown>) => void;
    emitOpen: () => void;
    emitError: (err: Error) => void;
  }[] = [];
  const httpsState: { status: number; body: string } = { status: 200, body: "{}" };

  // Minimal event emitter — avoids TDZ on node:events imports inside mocks.
  class MiniEmitter {
    handlers = new Map<string, Set<(arg: unknown) => void>>();
    on(event: string, fn: (arg: unknown) => void) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(fn);
    }
    emit(event: string, arg?: unknown) {
      this.handlers.get(event)?.forEach((fn) => fn(arg));
    }
  }

  class FakeWebSocket extends MiniEmitter {
    sent: string[] = [];
    constructor(public url: string) {
      super();
      const self = this;
      calls.push({
        url,
        sent: self.sent,
        reply: (type, payload) =>
          self.emit(
            "message",
            Buffer.from(JSON.stringify({ type, payload })),
          ),
        emitOpen: () => self.emit("open"),
        emitError: (err) => self.emit("error", err),
      });
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
  }

  return { mockFiles, calls, FakeWebSocket, httpsState };
});

mockFiles["C:\\Users\\u\\.antigravity_cockpit\\server.json"] = JSON.stringify({
  ws_port: 19528,
  version: "1.3.21",
  pid: 123,
  auth_token: "session-tok",
});

vi.mock("node:fs", () => ({
  existsSync: (p: string) => Object.prototype.hasOwnProperty.call(mockFiles, p),
  readFileSync: (p: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error("ENOENT");
  },
}));

vi.mock("node:os", () => ({ homedir: () => "C:\\Users\\u" }));

vi.mock("node:https", () => ({
  request: (opts: unknown, cb: (res: unknown) => void) => {
    const req = {
      on: () => req,
      write: () => {},
      end: () => {
        setTimeout(() => {
          const res = {
            statusCode: httpsState.status,
            on: (event: string, fn: (arg?: unknown) => void) => {
              if (event === "data") {
                fn(Buffer.from(httpsState.body));
              } else if (event === "end") {
                fn();
              }
              return res;
            },
          };
          cb(res);
        }, 0);
      },
      destroy: () => {},
    };
    return req;
  },
}));

vi.mock("../platform/index.js", () => ({
  platformAdapter: {
    findProcessPidsByName: vi.fn().mockResolvedValue([999]),
  },
}));

vi.mock("../platform/shared.js", () => ({
  runCommand: vi.fn().mockResolvedValue(""),
}));

vi.mock("../win-credential.js", () => ({
  writeAntigravityCredential: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../antigravity-launch.js", () => ({
  launchAntigravity: vi.fn().mockReturnValue({ method: "bat", command: "fake.bat" }),
}));

vi.mock("ws", () => ({
  WebSocket: FakeWebSocket,
  default: { WebSocket: FakeWebSocket },
}));

import {
  readCockpitServerInfo,
  isCockpitWsEnabled,
  cockpitRequest,
  cockpitStatus,
  cockpitAccounts,
  cockpitSwitchAccount,
  parseQuotaCacheEntry,
  toEpochMs,
  CockpitError,
} from "../cockpit.js";
import { registerCockpitRoutes } from "../routes/cockpit.js";

beforeEach(() => {
  calls.length = 0;
});

describe("readCockpitServerInfo", () => {
  it("parses server.json from the cockpit dir", () => {
    const info = readCockpitServerInfo();
    expect(info.ws_port).toBe(19528);
    expect(info.version).toBe("1.3.21");
    expect(info.pid).toBe(123);
  });

  it("throws not_installed when server.json is missing", () => {
    const serverFile = "C:\\Users\\u\\.antigravity_cockpit\\server.json";
    const original = mockFiles[serverFile];
    delete mockFiles[serverFile];
    try {
      let caught: unknown;
      try {
        readCockpitServerInfo();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CockpitError);
      expect((caught as CockpitError).code).toBe("not_installed");
    } finally {
      mockFiles[serverFile] = original;
    }
  });
});

describe("isCockpitWsEnabled", () => {
  it("defaults to enabled when config.json is unreadable", () => {
    expect(isCockpitWsEnabled()).toBe(true);
  });

  it("respects ws_enabled: false", () => {
    mockFiles["C:\\Users\\u\\.antigravity_cockpit\\config.json"] = JSON.stringify({
      ws_enabled: false,
    });
    expect(isCockpitWsEnabled()).toBe(false);
    delete mockFiles["C:\\Users\\u\\.antigravity_cockpit\\config.json"];
  });
});

describe("cockpitRequest", () => {
  it("sends the envelope and resolves on the matching request_id", async () => {
    const p = cockpitRequest("request.get_accounts");
    const call = calls[0];
    expect(call.url).toBe("ws://127.0.0.1:19528");
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    expect(sent.type).toBe("request.get_accounts");
    expect(typeof sent.payload.request_id).toBe("string");

    // Unrelated broadcast first, then the real answer
    call.reply("response.accounts", { request_id: "other-id", accounts: [] });
    call.reply("response.accounts", {
      request_id: sent.payload.request_id,
      accounts: [{ id: "a1", email: "x@y.z" }],
    });

    await expect(p).resolves.toEqual({
      request_id: sent.payload.request_id,
      accounts: [{ id: "a1", email: "x@y.z" }],
    });
  });

  it("rejects with the error payload on response.error", async () => {
    const p = cockpitRequest("request.switch_account", { account_id: "a1" });
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.error", {
      request_id: sent.payload.request_id,
      error: "账号不存在",
    });
    await expect(p).rejects.toThrow("账号不存在");
  });

  it("rejects on connection errors", async () => {
    const p = cockpitRequest("request.get_accounts");
    const call = calls[0];
    call.emitError(new Error("ECONNREFUSED"));
    await expect(p).rejects.toThrow("ECONNREFUSED");
  });
});

describe("cockpitStatus / accounts / switch", () => {
  it("reports connected when the service responds", async () => {
    const p = cockpitStatus();
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.current_account", {
      request_id: sent.payload.request_id,
      account: null,
    });
    await expect(p).resolves.toMatchObject({
      connected: true,
      wsPort: 19528,
      version: "1.3.21",
    });
  });

  it("lists accounts and current id", async () => {
    const p = cockpitAccounts();
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.accounts", {
      request_id: sent.payload.request_id,
      accounts: [{ id: "a1", email: "x@y.z", is_current: true }],
      current_account_id: "a1",
    });
    await expect(p).resolves.toEqual({
      accounts: [{ id: "a1", email: "x@y.z", is_current: true }],
      currentAccountId: "a1",
    });
  });

  it("switches accounts with the account_id payload", async () => {
    const p = cockpitSwitchAccount("a2");
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    expect(sent.type).toBe("request.switch_account");
    expect(sent.payload.account_id).toBe("a2");
    call.reply("response.success", {
      request_id: sent.payload.request_id,
      message: "切换账号成功",
    });
    await expect(p).resolves.toEqual({ message: "切换账号成功" });
  });
});

describe("quota cache parsing", () => {
  const cacheFile = JSON.stringify({
    email: "One@Gmail.com ",
    updatedAt: 1786859351000,
    payload: {
      models: {
        "chat-a": {
          displayName: "Claude Opus 4.6",
          quotaInfo: { remainingFraction: 0.42, resetTime: "2026-08-20" },
        },
        "chat-b": {
          displayName: "Claude Opus 4.6",
          quotaInfo: { remainingFraction: 0.9 },
        },
        "chat-c": {
          displayName: "Gemini 3.1 Flash",
          quotaInfo: { remainingFraction: 1 },
        },
        "chat-d": { quotaInfo: { remainingFraction: 1 } }, // no displayName
        "chat-e": { displayName: "Broken" }, // no fraction
      },
    },
  });

  it("parses models, dedupes by display name keeping the lowest percentage", () => {
    const parsed = parseQuotaCacheEntry(cacheFile);
    expect(parsed?.email).toBe("one@gmail.com");
    const names = parsed?.quota.models.map((m) => `${m.name}:${m.remainingPercent}`);
    expect(names).toEqual(["Claude Opus 4.6:42", "Gemini 3.1 Flash:100"]);
    const opus = parsed?.quota.models[0];
    expect(opus?.resetTime).toBe("2026-08-20");
  });

  it("normalizes updatedAt to epoch ms", () => {
    expect(toEpochMs(1786859351)).toBe(1786859351000);
    expect(toEpochMs(1786859351000)).toBe(1786859351000);
  });

  it("returns null on invalid JSON or missing email", () => {
    expect(parseQuotaCacheEntry("not json")).toBeNull();
    expect(parseQuotaCacheEntry(JSON.stringify({ updatedAt: 1 }))).toBeNull();
  });

  it("extracts quota_summary groups alongside per-model values", () => {
    const parsed = parseQuotaCacheEntry(
      JSON.stringify({
        email: "one@gmail.com",
        updatedAt: 1786859351000,
        payload: {
          models: {
            "chat-a": {
              displayName: "Gemini 3.1 Flash",
              quotaInfo: { remainingFraction: 1 },
            },
          },
          quota_summary: {
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    window: "weekly",
                    remainingFraction: 0.77,
                    resetTime: "2026-08-23T14:54:51Z",
                  },
                  {
                    bucketId: "gemini-5h",
                    window: "5h",
                    remainingFraction: 1,
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    expect(parsed?.quota.groups).toEqual([
      {
        name: "Gemini Models",
        buckets: [
          { window: "weekly", remainingPercent: 77, resetTime: "2026-08-23T14:54:51Z" },
          { window: "5h", remainingPercent: 100 },
        ],
      },
    ]);
  });
});

describe("cockpit routes", () => {
  function createApp() {
    const app = new Hono();
    registerCockpitRoutes(app);
    return app;
  }

  it("GET /api/cockpit/accounts returns the list", async () => {
    const p = createApp().request("/api/cockpit/accounts");
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.accounts", {
      request_id: sent.payload.request_id,
      accounts: [{ id: "a1", email: "x@y.z", is_current: true }],
      current_account_id: "a1",
    });
    const res = await p;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentAccountId).toBe("a1");
    expect(body.accounts).toHaveLength(1);
  });

  it("GET /api/cockpit/accounts returns 503 when cockpit is unreachable", async () => {
    const p = createApp().request("/api/cockpit/accounts");
    const call = calls[0];
    call.emitError(new Error("boom"));
    const res = await p;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("unreachable");
  });

  /** Reply to the get_accounts_with_tokens handshake used by the switch flow. */
  async function answerTokensCall(index = 0, accounts = tokenAccountsFixture) {
    const call = calls[index];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    expect(sent.type).toBe("request.get_accounts_with_tokens");
    call.reply("response.accounts_with_tokens", {
      request_id: sent.payload.request_id,
      accounts,
    });
    return call;
  }

  const tokenAccountsFixture = [
    {
      id: "a2",
      email: "two@gmail.com",
      is_current: false,
      access_token: "tok2",
      refresh_token: "rtok2",
      expires_at: 9999999999999,
    },
    {
      id: "bad",
      email: "bad@gmail.com",
      is_current: false,
      access_token: "tokb",
      refresh_token: "rtokb",
      expires_at: 9999999999999,
    },
  ];

  it("POST switch returns ok on success", async () => {
    const { writeAntigravityCredential } = await import("../win-credential.js");
    const { platformAdapter } = await import("../platform/index.js");
    vi.mocked(platformAdapter.findProcessPidsByName).mockResolvedValueOnce([]);

    const p = createApp().request("/api/cockpit/accounts/a2/switch", {
      method: "POST",
    });
    await answerTokensCall();

    // Second WS call: the actual switch
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    const switchCall = calls[1];
    switchCall.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(switchCall.sent[0]);
    expect(sent.type).toBe("request.switch_account");
    expect(sent.payload.account_id).toBe("a2");
    switchCall.reply("response.success", {
      request_id: sent.payload.request_id,
      message: "切换账号成功",
    });
    const res = await p;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Credential written before the cockpit orchestration
    expect(writeAntigravityCredential).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "tok2", refresh_token: "rtok2" }),
    );
  });

  it("POST switch kills running Antigravity processes before restarting", async () => {
    const { runCommand } = await import("../platform/shared.js");
    const { platformAdapter } = await import("../platform/index.js");
    vi.mocked(platformAdapter.findProcessPidsByName)
      .mockResolvedValueOnce([111, 222]) // kill scan
      .mockResolvedValue([]); // later checks (scheduleRelaunchIfDead)

    const p = createApp().request("/api/cockpit/accounts/a2/switch", {
      method: "POST",
    });
    await answerTokensCall();
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    const switchCall = calls[1];
    switchCall.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(switchCall.sent[0]);
    switchCall.reply("response.success", {
      request_id: sent.payload.request_id,
      message: "切换账号成功",
    });
    await p;
    expect(runCommand).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "111", "/T", "/F"],
      expect.anything(),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "222", "/T", "/F"],
      expect.anything(),
    );
  });

  it("POST switch falls back to direct relaunch when cockpit orchestration fails", async () => {
    const { launchAntigravity } = await import("../antigravity-launch.js");
    const { platformAdapter } = await import("../platform/index.js");
    vi.mocked(platformAdapter.findProcessPidsByName).mockResolvedValue([]);

    const p = createApp().request("/api/cockpit/accounts/a2/switch", {
      method: "POST",
    });
    await answerTokensCall();
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    const switchCall = calls[1];
    switchCall.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(switchCall.sent[0]);
    switchCall.reply("response.error", {
      request_id: sent.payload.request_id,
      error: "APP_PATH_NOT_FOUND:antigravity",
    });
    const res = await p;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain("已切换账号并重启");
    expect(launchAntigravity).toHaveBeenCalledTimes(1);
  });

  it("POST switch returns 502 when the account has no usable token", async () => {
    const { platformAdapter } = await import("../platform/index.js");
    vi.mocked(platformAdapter.findProcessPidsByName).mockResolvedValue([]);

    const p = createApp().request("/api/cockpit/accounts/ghost/switch", {
      method: "POST",
    });
    await answerTokensCall();
    const res = await p;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("账号不存在");
  });

  it("POST refresh-quota fetches live quota via tokens and returns parsed models", async () => {
    httpsState.status = 200;
    httpsState.body = JSON.stringify({
      paidTier: { id: "g1-pro-tier" },
      models: {
        "chat-a": {
          displayName: "Claude Opus 4.6",
          quotaInfo: { remainingFraction: 0.3, resetTime: "2026-08-20" },
        },
      },
    });

    const p = createApp().request("/api/cockpit/accounts/a1/refresh-quota", {
      method: "POST",
    });
    // Step 1: WS get_accounts_with_tokens (with the session auth token)
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    expect(sent.type).toBe("request.get_accounts_with_tokens");
    expect(sent.payload.auth_token).toBe("session-tok");
    call.reply("response.accounts_with_tokens", {
      request_id: sent.payload.request_id,
      accounts: [
        {
          id: "a1",
          email: "one@gmail.com",
          is_current: true,
          access_token: "tok",
          refresh_token: "rtok",
          expires_at: 9999999999999,
        },
      ],
    });

    const res = await p;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe("one@gmail.com");
    expect(body.tierId).toBe("g1-pro-tier");
    expect(body.quota.models).toEqual([
      { name: "Claude Opus 4.6", remainingPercent: 30, resetTime: "2026-08-20" },
    ]);
    expect(body.quota.updatedAt).toBeGreaterThan(0);
    // Tokens must never leak into the response
    expect(JSON.stringify(body)).not.toContain("tok");
  });

  it("POST refresh-quota maps 401 to an expired-token message", async () => {
    httpsState.status = 401;
    httpsState.body = "{}";

    const p = createApp().request("/api/cockpit/accounts/a1/refresh-quota", {
      method: "POST",
    });
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.accounts_with_tokens", {
      request_id: sent.payload.request_id,
      accounts: [
        {
          id: "a1",
          email: "one@gmail.com",
          is_current: false,
          access_token: "tok",
          refresh_token: "rtok",
          expires_at: 1,
        },
      ],
    });

    const res = await p;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("令牌已过期");
  });

  it("POST refresh-quota returns an error for an unknown account", async () => {
    httpsState.status = 200;
    httpsState.body = "{}";
    const p = createApp().request("/api/cockpit/accounts/ghost/refresh-quota", {
      method: "POST",
    });
    const call = calls[0];
    call.emitOpen();
    await new Promise((r) => setTimeout(r, 0));
    const sent = JSON.parse(call.sent[0]);
    call.reply("response.accounts_with_tokens", {
      request_id: sent.payload.request_id,
      accounts: [],
    });
    const res = await p;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("账号不存在");
  });
});
