/**
 * /api/cockpit/* routes — remote cockpit-tools integration.
 *
 * Bridges the locally installed cockpit-tools account manager
 * (https://github.com/jlcodes99/cockpit-tools) so the mobile client can list
 * and switch Antigravity accounts, and refresh per-account quotas live.
 * Only token-free data is exposed — account tokens are fetched server-side
 * for quota calls and never leave the proxy.
 */

import type { Hono } from "hono";
import {
  cockpitStatus,
  cockpitAccounts,
  cockpitSwitchAccountNative,
  cockpitRefreshAccountQuota,
  readCockpitQuotas,
  antigravityProcessPids,
  CockpitError,
} from "../cockpit.js";
import { launchAntigravity } from "../antigravity-launch.js";

/**
 * cockpit kills Antigravity during the switch and restarts it from its
 * configured path. If that restart fails for any reason, relaunch via
 * our configured launcher so remote control is never left stranded.
 */
function scheduleRelaunchIfDead(): void {
  const timer = setTimeout(async () => {
    try {
      const pids = await antigravityProcessPids();
      if (pids.length > 0) return;
      launchAntigravity(process.env);
      console.log(
        "🚀 cockpit switched account but Antigravity stayed down — relaunched via launcher",
      );
    } catch {}
  }, 15_000);
  timer.unref?.();
}

export function registerCockpitRoutes(app: Hono): void {
  app.get("/api/cockpit/status", async (c) => {
    const status = await cockpitStatus();
    return c.json(status);
  });

  app.get("/api/cockpit/accounts", async (c) => {
    try {
      const quotas = readCockpitQuotas();
      const { accounts, currentAccountId } = await cockpitAccounts();
      const withQuota = accounts.map((account) => {
        const quota = quotas.get(account.email.trim().toLowerCase());
        return quota ? { ...account, quota } : { ...account, quota: null };
      });
      return c.json({ accounts: withQuota, currentAccountId });
    } catch (err) {
      if (err instanceof CockpitError) {
        return c.json({ error: err.message, code: err.code }, 503);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/cockpit/accounts/:id/switch", async (c) => {
    const accountId = c.req.param("id");
    if (!accountId) {
      return c.json({ error: "Missing account id" }, 400);
    }

    try {
      const result = await cockpitSwitchAccountNative(accountId);
      scheduleRelaunchIfDead();
      return c.json({ ok: true, message: result.message });
    } catch (err) {
      if (err instanceof CockpitError) {
        return c.json({ error: err.message, code: err.code }, 502);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/cockpit/accounts/:id/refresh-quota", async (c) => {
    const accountId = c.req.param("id");
    if (!accountId) {
      return c.json({ error: "Missing account id" }, 400);
    }
    try {
      const result = await cockpitRefreshAccountQuota(accountId);
      return c.json({
        ok: true,
        email: result.email,
        quota: result.quota,
        ...(result.tierId ? { tierId: result.tierId } : {}),
      });
    } catch (err) {
      if (err instanceof CockpitError) {
        return c.json({ error: err.message, code: err.code }, 502);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });
}
