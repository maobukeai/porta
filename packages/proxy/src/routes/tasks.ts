/**
 * /api/conversations/:id/tasks routes — running task control & management
 */

import type { Hono } from "hono";
import { rpcForConversation } from "../routing.js";
import { handleRPCError } from "../errors.js";
import { getMetadata } from "../metadata.js";

export function registerTaskRoutes(app: Hono): void {
  // 1. POST /api/conversations/:id/tasks/:taskId/kill
  app.post("/api/conversations/:id/tasks/:taskId/kill", async (c) => {
    const cascadeId = c.req.param("id");
    const taskId = c.req.param("taskId");
    if (!cascadeId || !taskId) {
      return c.json({ error: "Missing cascadeId or taskId" }, 400);
    }

    try {
      const metadata = await getMetadata(true);
      const res = await rpcForConversation("SendCommandInput", cascadeId, {
        metadata,
        cascadeId,
        commandId: taskId,
        terminate: true,
      });

      return c.json({ ok: true, status: "terminated", result: res });
    } catch (err) {
      // Surface real failures — the frontend rolls back its optimistic
      // "terminated" state based on this error response.
      return handleRPCError(c, err);
    }
  });

  // 2. POST /api/conversations/:id/tasks/:taskId/input
  app.post("/api/conversations/:id/tasks/:taskId/input", async (c) => {
    const cascadeId = c.req.param("id");
    const taskId = c.req.param("taskId");
    if (!cascadeId || !taskId) {
      return c.json({ error: "Missing cascadeId or taskId" }, 400);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const input = body.input || "";
      const metadata = await getMetadata(true);

      const res = await rpcForConversation("SendCommandInput", cascadeId, {
        metadata,
        cascadeId,
        commandId: taskId,
        input,
      });

      return c.json({ ok: true, result: res });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
