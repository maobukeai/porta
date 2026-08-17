/**
 * Optional shared-token authentication.
 *
 * When PORTA_TOKEN is set, every HTTP request must carry the token via
 * `Authorization: Bearer <token>` or `X-Porta-Token: <token>`, and every
 * WebSocket upgrade via `?token=<token>` or the Authorization header.
 * This protects LAN-exposed deployments (terminal exec / PTY shell) from
 * unauthenticated use by other devices on the same network.
 *
 * When PORTA_TOKEN is unset (default, loopback-only setups), all requests pass.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export function getAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.PORTA_TOKEN?.trim();
  return token ? token : undefined;
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

function tokenEquals(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Burn the same amount of time as the equal-length case.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Extract the token presented by an HTTP request (header or query param). */
export function presentedToken(
  headers: { authorization?: string; "x-porta-token"?: string },
  url: URL,
): string | undefined {
  return (
    extractBearerToken(headers.authorization) ??
    headers["x-porta-token"]?.trim() ??
    url.searchParams.get("token")?.trim() ??
    undefined
  );
}

/** True when the request may proceed. Always true when no token is configured. */
export function isAuthorized(
  presented: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getAuthToken(env);
  if (!expected) return true;
  return Boolean(presented) && tokenEquals(presented as string, expected);
}

/** Hono middleware guarding all /api routes when PORTA_TOKEN is configured. */
export function tokenAuth(env: NodeJS.ProcessEnv = process.env): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    const expected = getAuthToken(env);
    if (!expected) return next();

    const presented = presentedToken(
      {
        authorization: c.req.header("authorization"),
        "x-porta-token": c.req.header("x-porta-token"),
      },
      new URL(c.req.url),
    );

    if (!isAuthorized(presented, env)) {
      return c.json({ error: "Unauthorized: invalid or missing access token" }, 401);
    }
    return next();
  };
}
