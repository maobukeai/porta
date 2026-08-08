/**
 * /api/git route — returns Git status, logs, diffs, and executes commits/pushes
 */

import type { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

function resolvePathFromUri(uri?: string): string {
  if (!uri) return process.cwd();
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri.replace(/^file:\/\/\/?/, "").replace(/\//g, "\\");
    }
  }
  return uri;
}

export function registerGitRoutes(app: Hono): void {
  // 1. GET /api/git/status
  app.get("/api/git/status", async (c) => {
    const workspaceUri = c.req.query("workspaceUri") || c.req.query("workspace");
    const cwd = resolvePathFromUri(workspaceUri);

    if (!existsSync(cwd)) {
      return c.json({ error: `目录不存在: ${cwd}`, files: [], branch: "main", totalChanges: 0 }, 400);
    }

    try {
      // Get current branch
      let branch = "main";
      try {
        const { stdout: branchOut } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
        branch = branchOut.trim() || "main";
      } catch {
        // Fallback
      }

      // Get status
      const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd });
      const files: { status: string; path: string; staged: boolean }[] = [];
      const lines = statusOut.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.slice(3).trim().replace(/^"|"$/g, "");

        if (x !== " " && x !== "?") {
          files.push({ status: x, path: file, staged: true });
        }
        if (y !== " ") {
          files.push({ status: y === "?" ? "U" : y, path: file, staged: false });
        }
      }

      // Ahead/Behind count
      let ahead = 0;
      let behind = 0;
      try {
        const { stdout: revOut } = await execFileAsync(
          "git",
          ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
          { cwd },
        );
        const [b, a] = revOut.trim().split(/\s+/).map(Number);
        behind = b || 0;
        ahead = a || 0;
      } catch {
        // No upstream configured
      }

      return c.json({
        branch,
        ahead,
        behind,
        files,
        totalChanges: files.length,
      });
    } catch (err) {
      return c.json({
        error: (err as Error).message,
        branch: "main",
        files: [],
        totalChanges: 0,
      });
    }
  });

  // 2. GET /api/git/log
  app.get("/api/git/log", async (c) => {
    const workspaceUri = c.req.query("workspaceUri") || c.req.query("workspace");
    const limit = parseInt(c.req.query("limit") || "15", 10);
    const cwd = resolvePathFromUri(workspaceUri);

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", `-n${limit}`, `--pretty=format:%h|%s|%an|%cr|%cd|%d`],
        { cwd },
      );
      const logs = stdout
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((line) => {
          const [hash, message, author, relativeTime, date, decoration] = line.split("|");
          const refs = decoration ? decoration.trim().replace(/^\(|\)$/g, "") : "";
          const isRemotePushed = refs.includes("origin/");
          const isHead = refs.includes("HEAD");
          return { hash, message, author, relativeTime, date, refs, isRemotePushed, isHead };
        });

      return c.json({ logs });
    } catch (err) {
      return c.json({ error: (err as Error).message, logs: [] });
    }
  });

  // 3. GET /api/git/diff
  app.get("/api/git/diff", async (c) => {
    const workspaceUri = c.req.query("workspaceUri") || c.req.query("workspace");
    const file = c.req.query("file");
    const cwd = resolvePathFromUri(workspaceUri);

    try {
      const args = file ? ["diff", "HEAD", "--", file] : ["diff", "HEAD"];
      const { stdout } = await execFileAsync("git", args, { cwd });
      return c.json({ diff: stdout });
    } catch (err) {
      return c.json({ error: (err as Error).message, diff: "" });
    }
  });

  // 4. POST /api/git/commit
  app.post("/api/git/commit", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri, message, push } = body;

      if (!message || !message.trim()) {
        return c.json({ error: "提交信息不能为空" }, 400);
      }

      const cwd = resolvePathFromUri(workspaceUri);

      // Get current branch name
      let currentBranch = "main";
      try {
        const { stdout: bOut } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
        currentBranch = bOut.trim() || "main";
      } catch {
        // Fallback
      }

      // Auto-stage all modified/untracked files if nothing staged
      const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd });
      const lines = statusOut.split(/\r?\n/).filter(Boolean);
      const stagedCount = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;

      if (stagedCount === 0) {
        await execFileAsync("git", ["add", "."], { cwd });
      }

      // Commit
      const { stdout: commitOut } = await execFileAsync(
        "git",
        ["commit", "-m", message.trim()],
        { cwd },
      );

      let pushOut = "";
      if (push) {
        try {
          const { stdout: pOut } = await execFileAsync("git", ["push", "origin", currentBranch], { cwd });
          pushOut = pOut;
        } catch (pushErr) {
          try {
            const { stdout: pOut2 } = await execFileAsync("git", ["push", "-u", "origin", currentBranch], { cwd });
            pushOut = pOut2;
          } catch (pushErr2) {
            const rawError = (pushErr2 as Error).message || (pushErr as Error).message;
            return c.json({
              error: `代码已成功在本地 Commit，但推送至 GitHub (${currentBranch}) 失败: ${rawError}`,
              commitOutput: commitOut,
              pushOutput: rawError,
            }, 400);
          }
        }
      }

      return c.json({
        success: true,
        commitOutput: commitOut,
        pushOutput: pushOut,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 5. POST /api/git/stage
  app.post("/api/git/stage", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri, file } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      const targets = Array.isArray(file) ? file : file ? [file] : ["."];
      const { stdout } = await execFileAsync("git", ["add", "--", ...targets], { cwd });
      return c.json({ success: true, output: stdout });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 6. POST /api/git/unstage
  app.post("/api/git/unstage", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri, file } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      const targets = Array.isArray(file) ? file : file ? [file] : ["."];
      const { stdout } = await execFileAsync("git", ["restore", "--staged", "--", ...targets], { cwd });
      return c.json({ success: true, output: stdout });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 7. POST /api/git/discard
  app.post("/api/git/discard", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri, file } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      if (file) {
        const targets = Array.isArray(file) ? file : [file];
        try {
          await execFileAsync("git", ["checkout", "HEAD", "--", ...targets], { cwd });
        } catch {
          // If untracked
          await execFileAsync("git", ["clean", "-fd", "--", ...targets], { cwd });
        }
      } else {
        await execFileAsync("git", ["checkout", "HEAD", "--", "."], { cwd });
        await execFileAsync("git", ["clean", "-fd"], { cwd });
      }

      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 8. GET /api/git/branches
  app.get("/api/git/branches", async (c) => {
    const workspaceUri = c.req.query("workspaceUri") || c.req.query("workspace");
    const cwd = resolvePathFromUri(workspaceUri);

    try {
      const { stdout } = await execFileAsync("git", ["branch", "-a"], { cwd });
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let current = "main";
      const branches: string[] = [];

      for (const line of lines) {
        const isCurrent = line.startsWith("*");
        const cleanName = line.replace(/^\*?\s+/, "").replace(/^remotes\//, "").trim();
        if (isCurrent) current = cleanName;
        if (!branches.includes(cleanName) && !cleanName.includes("HEAD ->")) {
          branches.push(cleanName);
        }
      }

      return c.json({ current, branches });
    } catch (err) {
      return c.json({ error: (err as Error).message, current: "main", branches: ["main"] });
    }
  });

  // 9. POST /api/git/checkout
  app.post("/api/git/checkout", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri, branch, create = false } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      if (!branch || !branch.trim()) {
        return c.json({ error: "分支名称不能为空" }, 400);
      }

      const args = create ? ["checkout", "-b", branch.trim()] : ["checkout", branch.trim()];
      const { stdout } = await execFileAsync("git", args, { cwd });
      return c.json({ success: true, output: stdout });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 10. POST /api/git/pull
  app.post("/api/git/pull", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      const { stdout } = await execFileAsync("git", ["pull"], { cwd });
      return c.json({ success: true, output: stdout });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // 11. POST /api/git/ai-commit-msg
  app.post("/api/git/ai-commit-msg", async (c) => {
    try {
      const body = await c.req.json();
      const { workspaceUri } = body;
      const cwd = resolvePathFromUri(workspaceUri);

      // Get status and diffs
      let diffText = "";
      try {
        const { stdout: cachedDiff } = await execFileAsync("git", ["diff", "--cached"], { cwd });
        const { stdout: workingDiff } = await execFileAsync("git", ["diff"], { cwd });
        diffText = (cachedDiff + "\n" + workingDiff).trim();
      } catch {
        // Fallback
      }

      const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd });
      const statusLines = statusOut.split(/\r?\n/).filter(Boolean);
      const files = statusLines.map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));

      if (files.length === 0) {
        return c.json({ message: "chore: update codebase files", diffStat: "" });
      }

      // Analyze scope & type
      const packages = new Set<string>();
      let type = "feat";
      let actionDesc = "";

      const fileBasenames: string[] = [];
      for (const file of files) {
        const parts = file.split(/[/\\]/);
        const name = parts.pop() || file;
        fileBasenames.push(name.replace(/\.[^.]+$/, ""));

        if (file.includes("packages/web") || file.endsWith(".tsx") || file.endsWith(".jsx")) {
          packages.add("web");
        } else if (file.includes("packages/proxy") || file.endsWith(".ts")) {
          packages.add("proxy");
        }

        if (file.includes("test") || file.includes("spec")) type = "test";
        else if (file.endsWith(".css") || file.endsWith(".scss") || file.includes("style")) type = "style";
        else if (file.endsWith(".md") || file.includes("doc")) type = "docs";
        else if (file.includes("config") || file.includes("package.json")) type = "chore";
        else if (file.includes("fix") || file.includes("bug") || diffText.includes("fix") || diffText.includes("bug")) type = "fix";
      }

      const scope = Array.from(packages).join(",") || "project";

      // Detect specific components / functions from diff huff headers
      const hunkHeaders = diffText.split("\n").filter((l) => l.startsWith("@@"));
      const symbols = new Set<string>();

      for (const header of hunkHeaders) {
        const symbolMatch = /@@.*@@\s*(?:export\s+)?(?:function|class|const|interface|type)\s+([A-Za-z0-9_]+)/.exec(header);
        if (symbolMatch && symbolMatch[1]) {
          symbols.add(symbolMatch[1]);
        }
      }

      const primarySymbol = Array.from(symbols)[0];
      const primaryFile = fileBasenames[0] || "files";

      if (primarySymbol) {
        actionDesc = `refine ${primarySymbol} and ${primaryFile}`;
      } else if (fileBasenames.length === 1) {
        actionDesc = `update ${fileBasenames[0]}`;
      } else if (fileBasenames.length <= 3) {
        actionDesc = `update ${fileBasenames.join(", ")}`;
      } else {
        actionDesc = `update ${fileBasenames.slice(0, 2).join(", ")} and ${fileBasenames.length - 2} other files`;
      }

      // Generate dynamic message
      const message = `${type}(${scope}): ${actionDesc}`;

      return c.json({ message, filesCount: files.length, scope });
    } catch (err) {
      return c.json({ message: "chore: update codebase files" });
    }
  });
}
