import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tokenAuth } from "../auth.js";
import { validateWebSocketUpgrade } from "../ws.js";

function createApp(env: NodeJS.ProcessEnv) {
  const app = new Hono();
  app.use("/api/*", tokenAuth(env));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("HTTP token auth middleware", () => {
  it("passes through when PORTA_TOKEN is not configured", async () => {
    const app = createApp({});
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
  });

  it("rejects missing token when PORTA_TOKEN is set", async () => {
    const app = createApp({ PORTA_TOKEN: "sekret" });
    const res = await app.request("/api/ping");
    expect(res.status).toBe(401);
  });

  it("accepts a valid Bearer token", async () => {
    const app = createApp({ PORTA_TOKEN: "sekret" });
    const res = await app.request("/api/ping", {
      headers: { Authorization: "Bearer sekret" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts the token via X-Porta-Token header", async () => {
    const app = createApp({ PORTA_TOKEN: "sekret" });
    const res = await app.request("/api/ping", {
      headers: { "X-Porta-Token": "sekret" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token", async () => {
    const app = createApp({ PORTA_TOKEN: "sekret" });
    const res = await app.request("/api/ping", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("WebSocket upgrade token validation", () => {
  it("accepts a valid token query param when PORTA_TOKEN is set", () => {
    const env = { PORTA_TOKEN: "sekret" };
    expect(
      validateWebSocketUpgrade(
        "/api/conversations/abc123/ws?token=sekret",
        "http://localhost:5173",
        3170,
        undefined,
        { env },
      ),
    ).toEqual({ ok: true, type: "conversation", cascadeId: "abc123" });
  });

  it("accepts the token via Authorization header", () => {
    const env = { PORTA_TOKEN: "sekret" };
    expect(
      validateWebSocketUpgrade(
        "/api/terminal/ws",
        "http://localhost:5173",
        3170,
        undefined,
        { header: "Bearer sekret", env },
      ),
    ).toEqual({ ok: true, type: "terminal" });
  });

  it("rejects upgrades with a missing or wrong token", () => {
    const env = { PORTA_TOKEN: "sekret" };
    expect(
      validateWebSocketUpgrade("/api/terminal/ws", "http://localhost:5173", 3170, undefined, {
        env,
      }),
    ).toEqual({ ok: false, code: "unauthorized" });
    expect(
      validateWebSocketUpgrade(
        "/api/terminal/ws?token=wrong",
        "http://localhost:5173",
        3170,
        undefined,
        { env },
      ),
    ).toEqual({ ok: false, code: "unauthorized" });
  });

  it("skips token checks when PORTA_TOKEN is unset", () => {
    expect(
      validateWebSocketUpgrade("/api/terminal/ws", "http://localhost:5173", 3170, undefined, {
        env: {},
      }),
    ).toEqual({ ok: true, type: "terminal" });
  });
});
