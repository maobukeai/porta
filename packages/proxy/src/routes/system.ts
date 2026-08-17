/**
 * /api/system/* routes — remote diagnostics & Antigravity relaunch.
 *
 * The mobile client uses these when health polling reports zero Language
 * Servers: GET /diagnostics explains why, POST /antigravity/launch starts
 * the IDE on the desktop (through the user's configured launcher script)
 * so the LS comes back and the proxy auto-reconnects within its 10s
 * discovery TTL.
 */

import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { discovery } from "../routing.js";
import { antigravityProcessPids } from "../cockpit.js";
import {
  resolveIdePath,
  resolveLaunchPlan,
  launchAntigravity,
} from "../antigravity-launch.js";

export interface SystemDiagnostics {
  proxy: { port: number; uptime: number };
  languageServers: {
    pid: number;
    httpsPort: number;
    workspaceId?: string;
    source: string;
  }[];
  antigravity: {
    processRunning: boolean;
    pids: number[];
    idePath: string | null;
    idePathSource: "env" | "last-seen" | "default" | "none";
    launchable: boolean;
    launchMethod: "bat" | "exe" | null;
    batPath: string | null;
  };
}

export async function buildDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SystemDiagnostics> {
  // Force-refresh discovery: diagnostics must reflect the current state,
  // not a possibly-stale 10s cache.
  const instances = await discovery.getInstances(true);
  const pids = await antigravityProcessPids();
  const ide = resolveIdePath(env);

  let launchMethod: "bat" | "exe" | null = null;
  let batPath: string | null = env.PORTA_ANTIGRAVITY_LAUNCH_BAT?.trim() ?? null;
  if (batPath && existsSync(batPath)) {
    launchMethod = "bat";
  } else {
    batPath = null;
    try {
      resolveLaunchPlan(env);
      launchMethod = "exe";
    } catch {
      launchMethod = null;
    }
  }

  return {
    proxy: { port: parseInt(env.PORTA_PORT ?? "3170", 10), uptime: process.uptime() },
    languageServers: instances.map((i) => ({
      pid: i.pid,
      httpsPort: i.httpsPort,
      workspaceId: i.workspaceId,
      source: i.source,
    })),
    antigravity: {
      processRunning: pids.length > 0,
      pids,
      idePath: ide.path,
      idePathSource: ide.source,
      launchable: launchMethod !== null,
      launchMethod,
      batPath,
    },
  };
}

export function registerSystemRoutes(app: Hono): void {
  app.get("/api/system/diagnostics", async (c) => {
    try {
      return c.json(await buildDiagnostics(process.env));
    } catch (err) {
      return c.json(
        { error: `Diagnostics failed: ${(err as Error).message}` },
        500,
      );
    }
  });

  app.post("/api/system/antigravity/launch", async (c) => {
    const instances = await discovery.getInstances(true);
    if (instances.length > 0) {
      return c.json({
        started: false,
        reason: "language-server-already-running",
        languageServers: instances.length,
      });
    }

    try {
      const result = launchAntigravity(process.env);
      console.log(`🚀 Antigravity relaunch requested: ${result.command}`);
      return c.json({ started: true, method: result.method, command: result.command });
    } catch (err) {
      return c.json(
        {
          error: (err as Error).message,
          hint: "Set PORTA_ANTIGRAVITY_LAUNCH_BAT in .env to the launcher script, or ensure Antigravity is installed at a standard path",
        },
        400,
      );
    }
  });
}
