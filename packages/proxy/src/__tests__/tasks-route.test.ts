import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerTaskRoutes } from "../routes/tasks.js";

const mockRpcForConversation = vi.fn();
vi.mock("../routing.js", () => ({
  rpcForConversation: (...args: any[]) => mockRpcForConversation(...args),
}));

vi.mock("../metadata.js", () => ({
  getMetadata: vi.fn().mockResolvedValue({}),
}));

function createApp() {
  const app = new Hono();
  registerTaskRoutes(app);
  return app;
}

describe("Proxy Tasks Routes", () => {
  it("POST /api/conversations/:id/tasks/:taskId/kill triggers terminate RPC call", async () => {
    mockRpcForConversation.mockResolvedValueOnce({ ok: true });
    const app = createApp();
    const res = await app.request("/api/conversations/test-conv-1/tasks/task-cmd-1/kill", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("terminated");
    expect(mockRpcForConversation).toHaveBeenCalledWith(
      "SendCommandInput",
      "test-conv-1",
      expect.objectContaining({
        commandId: "task-cmd-1",
        terminate: true,
      }),
    );
  });

  it("kill surfaces RPC failures instead of reporting success", async () => {
    mockRpcForConversation.mockRejectedValueOnce(new Error("command not found"));
    const app = createApp();
    const res = await app.request("/api/conversations/test-conv-1/tasks/task-cmd-1/kill", {
      method: "POST",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(body.status).toBeUndefined();
  });

  it("POST /api/conversations/:id/tasks/:taskId/input sends interactive input", async () => {
    mockRpcForConversation.mockResolvedValueOnce({ ok: true });
    const app = createApp();
    const res = await app.request("/api/conversations/test-conv-1/tasks/task-cmd-1/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "y\n" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockRpcForConversation).toHaveBeenCalledWith(
      "SendCommandInput",
      "test-conv-1",
      expect.objectContaining({
        commandId: "task-cmd-1",
        input: "y\n",
      }),
    );
  });

  it("input surfaces RPC failures instead of reporting success", async () => {
    mockRpcForConversation.mockRejectedValueOnce(new Error("conversation gone"));
    const app = createApp();
    const res = await app.request("/api/conversations/test-conv-1/tasks/task-cmd-1/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "y\n" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
  });
});
