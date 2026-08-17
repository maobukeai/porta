import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../components/SettingsPanel";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    health: vi.fn().mockResolvedValue({ status: "ok", languageServers: [{ pid: 123 }] }),
    models: vi.fn().mockResolvedValue({ clientModelConfigs: [] }),
    userStatus: vi.fn().mockResolvedValue({}),
    quota: vi.fn().mockResolvedValue({}),
    agentCapabilities: {
      memory: vi.fn().mockResolvedValue({
        globalInstructions: [
          { id: "global-1", name: "全局 Gemini 指令", path: "/test/GEMINI.md", description: "全局指令", content: "hello global", sizeBytes: 100, isEditable: true },
        ],
        workspaceRules: [
          { id: "ws-1", name: "工作区规则", path: "/test/ws/GEMINI.md", description: "项目规则", content: "hello ws", sizeBytes: 200, isEditable: true },
        ],
        learnedMemories: [],
      }),
      saveMemory: vi.fn().mockResolvedValue({ success: true, path: "/test/GEMINI.md" }),
      plugins: vi.fn().mockResolvedValue({
        plugins: [
          { id: "superpowers-zh", name: "superpowers-zh", description: "超能力技能库", version: "1.0.0", author: "Antigravity", enabled: true, path: "/test/plugins/superpowers-zh", bundled: { skillsCount: 10, hooksCount: 2, mcpCount: 1, agentsCount: 0, rulesCount: 1 } },
        ],
        total: 1,
      }),
      togglePlugin: vi.fn().mockResolvedValue({ success: true }),
      skills: vi.fn().mockResolvedValue({
        skills: [
          { name: "brainstorming", title: "深度头脑风暴", description: "头脑风暴技能", source: "builtin", path: "/test/skills/brainstorming", hasScripts: false, hasReferences: true },
        ],
        total: 1,
      }),
      skillContent: vi.fn().mockResolvedValue({ markdown: "# Brainstorming Guide", scripts: [], references: [] }),
      subagents: vi.fn().mockResolvedValue({
        subagents: [
          { id: "self", name: "self", role: "镜像智能体", description: "继承主智能体全部配置", tools: ["Read", "Write"], systemPrompt: "You are self", source: "builtin" },
        ],
        total: 1,
      }),
      mcp: vi.fn().mockResolvedValue({
        servers: [
          { name: "blender-mcp", description: "Blender 3D", transport: "stdio", command: "python", disabled: false, toolsCount: 5, tools: [{ name: "get_scene", description: "获取场景" }], source: "config" },
        ],
        total: 1,
      }),
      toggleMcp: vi.fn().mockResolvedValue({ success: true }),
      commands: vi.fn().mockResolvedValue({
        commands: [
          { cmd: "/goal", name: "目标自治模式", description: "通宵超长任务自治推进", category: "slash_builtin", usage: "/goal <desc>" },
        ],
        total: 1,
      }),
      toggleCommand: vi.fn().mockResolvedValue({ success: true }),
      hooks: vi.fn().mockResolvedValue({
        hooks: [
          { id: "h1", name: "lint-checker", event: "PostToolUse", matcher: "run_command", command: "./lint.sh", enabled: true, source: "config" },
        ],
        total: 1,
      }),
    },
    statistics: {
      usage: vi.fn().mockResolvedValue({
        range: "30d",
        totalTokens: 3999108,
        formattedTokens: "399.9万",
        totalConversations: 21,
        totalMessages: 12677,
        activeDays: 5,
        consecutiveDays: 3,
        topModel: "Gemini 3.7 Flash (High)",
        topModelPercentage: 100,
        heatmap: [
          { date: "2026-08-15", count: 1962128, level: 4 },
        ],
        dailyTrends: [
          { dateLabel: "8月15日", isoDate: "2026-08-15", totalTokens: 1962128, models: { "Gemini 3.7 Flash (High)": 1962128 } },
        ],
        models: [
          { id: "Gemini 3.7 Flash (High)", name: "Gemini 3.7 Flash (High)", color: "#3b82f6" },
        ],
      }),
    },
  },
  getApiBase: vi.fn().mockReturnValue("http://localhost:3170"),
  setCustomApiBase: vi.fn(),
  getApiToken: vi.fn().mockReturnValue(""),
  setApiToken: vi.fn(),
}));

describe("SettingsPanel with 7 Agent Capabilities", () => {
  const defaultSettings = {
    defaultModel: null,
    defaultPlannerType: "conversational" as const,
    browserNotificationsEnabled: true,
    theme: "dark" as const,
    disabledSkills: [],
    disabledMcpTools: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Agent Capabilities sidebar items: 记忆, 插件, 技能, 子智能体, MCP 服务器, 命令, 钩子", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText("Agent 能力")).toBeInTheDocument();
    expect(screen.getAllByText("记忆").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("插件").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("技能").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("子智能体").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("MCP 服务器").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("命令").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("钩子").length).toBeGreaterThanOrEqual(1);
  });

  it("switches to plugins tab and displays plugin cards", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const pluginTabs = screen.getAllByText("插件");
    fireEvent.click(pluginTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/superpowers-zh/i)).toBeInTheDocument();
      expect(screen.getByText(/超能力技能库/i)).toBeInTheDocument();
    });
  });

  it("switches to skills tab and displays skill cards", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const skillTabs = screen.getAllByText("技能");
    fireEvent.click(skillTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/深度头脑风暴/i)).toBeInTheDocument();
    });
  });

  it("switches to subagents tab and displays subagent tools", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const agentTabs = screen.getAllByText("子智能体");
    fireEvent.click(agentTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("self")).toBeInTheDocument();
      expect(screen.getByText("镜像智能体")).toBeInTheDocument();
    });
  });

  it("switches to mcp servers tab and displays server info", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const mcpTabs = screen.getAllByText("MCP 服务器");
    fireEvent.click(mcpTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("blender-mcp")).toBeInTheDocument();
    });
  });

  it("switches to commands tab, toggles command switch and calls onUpdate with disabledCommands", async () => {
    const onUpdateMock = vi.fn();
    const { rerender } = render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={onUpdateMock}
        onBack={vi.fn()}
      />
    );

    const cmdTabs = screen.getAllByText("命令");
    fireEvent.click(cmdTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("/goal")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(onUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        disabledCommands: expect.arrayContaining(["/goal"]),
      })
    );

    // Re-render with updated settings (simulating reopening settings)
    rerender(
      <SettingsPanel
        settings={{
          ...defaultSettings,
          disabledCommands: ["/goal"],
        }}
        onUpdate={onUpdateMock}
        onBack={vi.fn()}
      />
    );

    expect(checkbox.checked).toBe(false);
  });

  it("switches to hooks tab and displays hook entries and allows creating new hook", async () => {
    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const hookTabs = screen.getAllByText("钩子");
    fireEvent.click(hookTabs[0]);

    await waitFor(() => {
      expect(screen.getByText("lint-checker")).toBeInTheDocument();
      expect(screen.getByText("PostToolUse")).toBeInTheDocument();
    });

    const newHookBtn = screen.getByTitle("新建钩子");
    fireEvent.click(newHookBtn);

    await waitFor(() => {
      expect(screen.getByText("新建钩子")).toBeInTheDocument();
      expect(screen.getByText("匹配器")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("例如 echo 'Hello from hook'")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("每行一个 argv 参数")).toBeInTheDocument();
    });
  });

  it("switches to usage stats tab and renders metrics grid, heatmap and daily trends", async () => {
    (api.statistics.usage as any).mockResolvedValue({
      range: "1d",
      totalTokens: 3999108,
      formattedTokens: "399.9万",
      totalConversations: 21,
      totalMessages: 12677,
      activeDays: 5,
      consecutiveDays: 3,
      topModel: "Gemini 3.7 Flash (High)",
      topModelPercentage: 100,
      heatmap: [
        { date: "2026-08-15", count: 1962128, level: 4 },
      ],
      dailyTrends: [
        { dateLabel: "00:00", isoDate: "2026-08-15T00:00", totalTokens: 1962128, models: { "Gemini 3.7 Flash (High)": 1962128 } },
      ],
      models: [
        { id: "Gemini 3.7 Flash (High)", name: "Gemini 3.7 Flash (High)", color: "#3b82f6" },
      ],
    });

    render(
      <SettingsPanel
        settings={defaultSettings}
        onUpdate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const statsTabs = screen.getAllByText("使用统计");
    const targetBtn = statsTabs[statsTabs.length - 1].closest("button") || statsTabs[0];
    fireEvent.click(targetBtn);

    await waitFor(() => {
      expect(screen.getByText("tokens 用量")).toBeInTheDocument();
      expect(screen.getByText("399.9万")).toBeInTheDocument();
      expect(screen.getByText("活跃热力图")).toBeInTheDocument();
      expect(screen.getByText("今日按小时 Token 趋势")).toBeInTheDocument();
      expect(screen.getAllByText("Gemini 3.7 Flash (High)").length).toBeGreaterThanOrEqual(1);
    });
  });
});
