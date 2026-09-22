import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockRpcAny = vi.fn();
vi.mock("../routing.js", () => ({
  rpcAny: (...args: unknown[]) => mockRpcAny(...args),
}));

const { registerTerminalRoutes } = await import("../routes/terminal.js");

describe("terminal routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    registerTerminalRoutes(app);
  });

  it("GET /api/terminal/info returns platform and shell information", async () => {
    const res = await app.request("/api/terminal/info");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.shell).toBeDefined();
    expect(data.platform).toBe(process.platform);
    expect(data.defaultCwd).toBe(process.cwd());
    expect(data.banner).toBeDefined();
  });

  it("POST /api/terminal/exec handles empty command gracefully", async () => {
    const res = await app.request("/api/terminal/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "   " }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.stdout).toBe("");
    expect(data.stderr).toBe("");
    expect(data.exitCode).toBe(0);
  });

  it("POST /api/terminal/exec executes commands through shell process", async () => {
    const mockChild = {
      stdout: { on: vi.fn((event, cb) => { if (event === "data") cb(Buffer.from("hello terminal\n")); }) },
      stderr: { on: vi.fn() },
      stdin: { end: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") setTimeout(() => cb(0), 10);
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);

    const res = await app.request("/api/terminal/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "echo hello terminal" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.stdout).toContain("hello terminal");
    expect(data.exitCode).toBe(0);
  });

  it("bridges official Language Server terminal RPCs", async () => {
    mockRpcAny.mockImplementation(async (method: string, body: any) => {
      if (method === "CreateTerminal") {
        return { terminal: { terminalId: "term-123", pid: 9999, title: "powershell" } };
      }
      if (method === "ListTerminals") {
        return { terminals: [{ terminalId: "term-123", pid: 9999, title: "powershell" }] };
      }
      if (method === "SendTerminalInput") {
        return { ok: true, receivedBytes: body.input };
      }
      if (method === "CloseTerminal") {
        return { closed: true };
      }
      return {};
    });

    // 1. Create
    const createRes = await app.request("/api/terminal/ls/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(200);
    expect(await createRes.json()).toEqual({
      terminal: { terminalId: "term-123", pid: 9999, title: "powershell" },
    });

    // 2. List
    const listRes = await app.request("/api/terminal/ls/list");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      terminals: [{ terminalId: "term-123", pid: 9999, title: "powershell" }],
    });

    // 3. Input
    const inputRes = await app.request("/api/terminal/ls/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId: "term-123", input: "ls\n" }),
    });
    expect(inputRes.status).toBe(200);
    expect(mockRpcAny).toHaveBeenCalledWith("SendTerminalInput", {
      terminalId: "term-123",
      input: Buffer.from("ls\n", "utf8").toString("base64"),
    });

    // 4. Close
    const closeRes = await app.request("/api/terminal/ls/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId: "term-123" }),
    });
    expect(closeRes.status).toBe(200);
    expect(mockRpcAny).toHaveBeenCalledWith("CloseTerminal", { terminalId: "term-123" });
  });
});
