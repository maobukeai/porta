/**
 * /api/files route — local file preview (images)
 */

import type { Hono } from "hono";
import { createReadStream, existsSync } from "node:fs";
import { extname, posix, win32 } from "node:path";
import { Readable } from "node:stream";
import { homedir } from "node:os";

const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

function fileUriToPath(
  fileUri: string,
  useWindowsPaths: boolean,
): string | null {
  try {
    const url = new URL(fileUri);
    if (url.protocol !== "file:") return null;

    const pathname = decodeURIComponent(url.pathname);

    if (!useWindowsPaths) {
      if (url.hostname && url.hostname !== "localhost") {
        return `//${url.hostname}${pathname}`;
      }
      return pathname;
    }

    // Node's fileURLToPath() follows the host runtime OS. This custom branch
    // keeps Windows file:// URIs testable and correctly resolved even when the
    // code runs on a non-Windows host.
    if (url.hostname && url.hostname !== "localhost") {
      return `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`;
    }

    if (/^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1).replaceAll("/", "\\");
    }

    return pathname.replaceAll("/", "\\");
  } catch {
    return null;
  }
}

function normalizeLegacyPath(
  filePath: string,
  useWindowsPaths: boolean,
): string {
  // Backward-compatibility for old clients that already rewrote file:///C:/...
  // into /C:/... before the URI-safe pipeline existed.
  if (useWindowsPaths && /^\/[A-Za-z]:/.test(filePath)) {
    return filePath.slice(1);
  }
  return filePath;
}

function looksLikeWindowsPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

function inferWindowsPathMode(
  home: string,
  fileRef: string,
  useWindowsPaths?: boolean,
): boolean {
  if (typeof useWindowsPaths === "boolean") {
    return useWindowsPaths;
  }

  if (looksLikeWindowsPath(home)) {
    return true;
  }

  if (home.startsWith("/") && !/^\/[A-Za-z]:/.test(home)) {
    return false;
  }

  if (fileRef.startsWith("file://")) {
    try {
      const url = new URL(fileRef);
      const pathname = decodeURIComponent(url.pathname);
      return (
        (Boolean(url.hostname) && url.hostname !== "localhost") ||
        /^\/[A-Za-z]:/.test(pathname)
      );
    } catch {
      return false;
    }
  }

  return looksLikeWindowsPath(fileRef) || /^\/[A-Za-z]:/.test(fileRef);
}

export function resolveSafeHomeFilePath(
  fileRef: string,
  home = homedir(),
  useWindowsPaths?: boolean,
): string | null {
  const windowsPaths = inferWindowsPathMode(home, fileRef, useWindowsPaths);
  const pathApi = windowsPaths ? win32 : posix;
  const resolvedHome = pathApi.resolve(home);
  const localPath = fileRef.startsWith("file://")
    ? fileUriToPath(fileRef, windowsPaths)
    : normalizeLegacyPath(fileRef, windowsPaths);
  if (!localPath) return null;

  const resolvedPath = pathApi.isAbsolute(localPath)
    ? pathApi.resolve(localPath)
    : pathApi.resolve(resolvedHome, localPath);
  const relativePath = pathApi.relative(resolvedHome, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    pathApi.isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedPath;
}

export function registerFileRoutes(app: Hono): void {
  app.get("/api/files", async (c) => {
    const fileRef = c.req.query("uri") ?? c.req.query("path");
    if (!fileRef) {
      return c.json({ error: "Missing 'uri' or 'path' query param" }, 400);
    }

    // Security: check home dir, or allow valid local image files on disk
    let resolved = resolveSafeHomeFilePath(fileRef);
    if (!resolved) {
      const cleanPath = fileRef.startsWith("file://")
        ? fileUriToPath(fileRef, process.platform === "win32")
        : normalizeLegacyPath(fileRef, process.platform === "win32");
      if (cleanPath && existsSync(cleanPath)) {
        const ext = extname(cleanPath).toLowerCase();
        if (IMAGE_EXTS[ext]) {
          resolved = cleanPath;
        }
      }
    }
    if (!resolved) {
      return c.json({ error: "Access denied" }, 403);
    }

    // Only serve images
    const ext = extname(resolved).toLowerCase();
    const mimeType = IMAGE_EXTS[ext];
    if (!mimeType) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    }

    if (!existsSync(resolved)) {
      return c.json({ error: "File not found" }, 404);
    }

    const stream = createReadStream(resolved);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  });

  app.get("/api/files/text", async (c) => {
    let fileRef = c.req.query("uri") ?? c.req.query("path");
    const workspaceUri = c.req.query("workspaceUri") ?? c.req.query("workspace");
    if (!fileRef) {
      return c.json({ error: "Missing 'uri' or 'path' query param" }, 400);
    }
    try {
      fileRef = decodeURIComponent(fileRef);
    } catch {}

    let resolved: string | null = null;
    const { resolve, normalize } = await import("node:path");
    const { existsSync, statSync, readFileSync } = await import("node:fs");

    // 1. Direct candidate normalization (supporting file:// protocol and absolute Windows/POSIX paths)
    let candidatePath = fileRef;
    if (candidatePath.startsWith("file://")) {
      try {
        const { fileURLToPath } = await import("node:url");
        candidatePath = fileURLToPath(candidatePath);
      } catch {
        candidatePath = candidatePath.replace(/^file:\/\/\/?/, "");
        if (/^[A-Za-z]:[\\/]/.test(candidatePath)) {
          // Windows drive path like C:/...
        } else if (!candidatePath.startsWith("/")) {
          candidatePath = `/${candidatePath}`;
        }
      }
    }

    const cleanCandidate = candidatePath.replace(/^file:\/\/\/?/, "");
    if (existsSync(cleanCandidate)) {
      resolved = cleanCandidate;
    } else if (existsSync(normalize(cleanCandidate))) {
      resolved = normalize(cleanCandidate);
    }

    // 2. Resolve with workspaceUri if given and not yet resolved
    if ((!resolved || !existsSync(resolved)) && workspaceUri) {
      let cwd = workspaceUri;
      if (cwd.startsWith("file://")) {
        try {
          const { fileURLToPath } = await import("node:url");
          cwd = fileURLToPath(cwd);
        } catch {
          cwd = cwd.replace(/^file:\/\/\/?/, "").replace(/\//g, "\\");
        }
      } else {
        cwd = cwd.replace(/^file:\/\/\/?/, "").replace(/\//g, "\\");
      }

      const fullPath = resolve(cwd, cleanCandidate);
      if (existsSync(fullPath)) {
        resolved = fullPath;
      }
    }

    // 3. Fallback to ~/.gemini safe path
    if (!resolved || !existsSync(resolved)) {
      resolved = resolveSafeHomeFilePath(fileRef);
    }

    // 4. Fallback to process.cwd()
    if (!resolved || !existsSync(resolved)) {
      const fromCwd = resolve(process.cwd(), cleanCandidate);
      if (existsSync(fromCwd)) {
        resolved = fromCwd;
      }
    }

    if (!resolved || !existsSync(resolved)) {
      return c.json({ error: "File not found", content: "" }, 404);
    }

    try {
      const stat = statSync(resolved);
      if (!stat.isFile()) {
        return c.json({ error: "Not a file", content: "" }, 400);
      }
      const isBinary = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|woff|woff2|ttf|eot|exe|dll)$/i.test(resolved);
      if (isBinary) {
        return c.json({ path: resolved, content: "[二进制文件无法直接显示]", isBinary: true, size: stat.size });
      }
      const content = readFileSync(resolved, "utf-8");
      return c.json({ path: resolved, content, size: stat.size });
    } catch (e) {
      return c.json({ error: (e as Error).message, content: "" }, 500);
    }
  });
}
