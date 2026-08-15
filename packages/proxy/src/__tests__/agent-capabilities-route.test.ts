import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerAgentCapabilitiesRoutes } from "../routes/agentCapabilities.js";

describe("Agent Capabilities Routes (/api/agent-capabilities/*)", () => {
  const app = new Hono();
  registerAgentCapabilitiesRoutes(app);

  it("GET /api/agent-capabilities/memory returns global instructions, workspace rules and learned memories", async () => {
    const res = await app.request("/api/agent-capabilities/memory");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.globalInstructions)).toBe(true);
    expect(Array.isArray(data.workspaceRules)).toBe(true);
    expect(Array.isArray(data.learnedMemories)).toBe(true);
    expect(data.globalInstructions.length).toBeGreaterThan(0);
  });

  it("GET /api/agent-capabilities/plugins returns list of discovered plugins", async () => {
    const res = await app.request("/api/agent-capabilities/plugins");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.plugins)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("GET /api/agent-capabilities/skills returns list of skills", async () => {
    const res = await app.request("/api/agent-capabilities/skills");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.skills)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("GET /api/agent-capabilities/subagents returns subagents including built-in ones", async () => {
    const res = await app.request("/api/agent-capabilities/subagents");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.subagents)).toBe(true);
    expect(data.subagents.some((s: any) => s.id === "self" || s.id === "research")).toBe(true);
  });

  it("GET /api/agent-capabilities/mcp returns list of MCP servers", async () => {
    const res = await app.request("/api/agent-capabilities/mcp");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.servers)).toBe(true);
  });

  it("GET /api/agent-capabilities/commands returns slash commands and plugin commands", async () => {
    const res = await app.request("/api/agent-capabilities/commands");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.commands)).toBe(true);
    expect(data.commands.some((c: any) => c.cmd === "/goal")).toBe(true);
  });

  it("GET /api/agent-capabilities/hooks returns discovered lifecycle hooks", async () => {
    const res = await app.request("/api/agent-capabilities/hooks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.hooks)).toBe(true);
  });

  it("POST /api/agent-capabilities/hooks/create rejects empty command", async () => {
    const res = await app.request("/api/agent-capabilities/hooks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "PreToolUse", command: "" }),
    });
    expect(res.status).toBe(400);
  });
});
