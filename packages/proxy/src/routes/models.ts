/**
 * /api/models route
 */

import type { Hono } from "hono";
import { rpcAny } from "../routing.js";
import { handleRPCError } from "../errors.js";

export function registerModelRoutes(app: Hono): void {
  app.get("/api/models", async (c) => {
    try {
      const data = await rpcAny("GetCascadeModelConfigData");
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/user-status", async (c) => {
    try {
      const data = await rpcAny("GetUserStatus");
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
