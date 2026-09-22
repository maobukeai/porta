import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockRpcAny = vi.fn();
vi.mock("../routing.js", () => ({
  rpcAny: (...args: unknown[]) => mockRpcAny(...args),
}));

vi.mock("../metadata.js", () => ({
  getMetadata: vi.fn().mockResolvedValue({ dummyMeta: true }),
}));

// Mock child_process execFile
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, callback: any) => {
    mockExecFile(cmd, args, opts, callback);
  },
}));

const { registerGitRoutes } = await import("../routes/git.js");

describe("git routes & AI commit generation", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    registerGitRoutes(app);
  });

  it("POST /api/git/ai-commit-msg uses Language Server GenerateCommitMessage RPC when available", async () => {
    mockRpcAny.mockResolvedValueOnce({
      commitMessage: {
        commitMessageSummary: "feat(proxy): bridge Language Server AI commit RPC",
        commitMessageBody: "Detailed explanation of changes",
        changedFileUris: ["file:///repo/packages/proxy/src/routes/git.ts"],
      },
    });

    const res = await app.request("/api/git/ai-commit-msg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceUri: "file:///test/repo",
        prompt: "feat: add commit message generator",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.message).toBe("feat(proxy): bridge Language Server AI commit RPC");
    expect(data.source).toBe("language_server");
    expect(data.filesCount).toBe(1);
    expect(data.body).toBe("Detailed explanation of changes");
    expect(mockRpcAny).toHaveBeenCalledWith("GenerateCommitMessage", expect.objectContaining({
      repoRoot: expect.stringContaining("test/repo"),
      userPrompt: "feat: add commit message generator",
    }));

    // Verify alias /api/git/ai-commit works identically
    mockRpcAny.mockResolvedValueOnce({
      commitMessage: {
        commitMessageSummary: "feat(proxy): bridge Language Server AI commit RPC via alias",
      },
    });
    const aliasRes = await app.request("/api/git/ai-commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceUri: "file:///test/repo" }),
    });
    expect(aliasRes.status).toBe(200);
    const aliasData = (await aliasRes.json()) as any;
    expect(aliasData.message).toBe("feat(proxy): bridge Language Server AI commit RPC via alias");
  });

  it("POST /api/git/ai-commit-msg falls back to local heuristic generator when RPC fails", async () => {
    mockRpcAny.mockRejectedValueOnce(new Error("Language server RPC unavailable"));

    // Mock git diff and status for local fallback
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      if (args[0] === "diff" && args[1] === "--cached") {
        callback(null, { stdout: "diff --git a/packages/web/App.tsx b/packages/web/App.tsx\n+export function App() {}", stderr: "" });
      } else if (args[0] === "diff") {
        callback(null, { stdout: "", stderr: "" });
      } else if (args[0] === "status") {
        callback(null, { stdout: " M packages/web/App.tsx\n", stderr: "" });
      } else {
        callback(null, { stdout: "", stderr: "" });
      }
    });

    const res = await app.request("/api/git/ai-commit-msg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceUri: "file:///test/repo",
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.message).toContain("App");
    expect(data.source).toBeUndefined();
  });
});
