/**
 * Antigravity Settings Panel (Agent 能力与系统全功能设置)
 * Includes full breakdown of 7 Agent Capabilities matching official client:
 * 1. 🧠 记忆 (Memory)
 * 2. 🧩 插件 (Plugins)
 * 3. 🪄 技能 (Skills)
 * 4. 🤖 子智能体 (Subagents)
 * 5. 🔌 MCP 服务器 (MCP Servers)
 * 6. >_ 命令 (Commands)
 * 7. ⚓ 钩子 (Hooks)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import {
  IconCheck,
  IconMonitor,
  IconSun,
  IconMoon,
  IconSliders,
  IconPuzzle,
  IconKeyboard,
  IconMessageSquare,
  IconChevronLeft,
  IconX,
  IconInfo,
  IconRefresh,
  IconUser,
  IconPalette,
  IconLayers,
  IconGlobe,
  IconFolder,
  IconBrain,
  IconWand,
  IconBot,
  IconPlug,
  IconCommandPrompt,
  IconAnchor,
  IconSearch,
  IconCopy,
  IconEdit,
  IconFileText,
  IconSparkles,
  IconPlus,
  IconTrash,
  IconDownload,
  IconVolume,
  IconBarChart,
} from "./Icons";
import { UsageStatisticsView } from "./UsageStatisticsView";
import { api, getApiBase, setCustomApiBase } from "../api/client";
import { CircularProgressRing } from "./ModelSelector";
import { SetupWizard } from "./SetupWizard";
import { CustomSelect } from "./CustomSelect";
import { triggerHaptic } from "../utils/haptics";
import {
  getCachedQuotaSummary,
  setCachedQuotaSummary,
} from "../utils/quotaCache";
import {
  requestBrowserNotificationPermission,
  playNotificationSound,
} from "../utils/browserNotifications";
import type {
  ClientSettings,
  UserQuotaSummary,
  ExecutionMode,
  MemoryRecord,
  MemorySummaryResponse,
  PluginInfo,
  SkillDetailedInfo,
  SkillContentResponse,
  SubagentInfo,
  McpServerDetailedInfo,
  CommandDefinition,
  HookDefinition,
} from "../types";

interface ModelConfig {
  label: string;
  modelOrAlias: { model: string };
  supportsImages: boolean;
  isRecommended: boolean;
  quotaInfo?: { remainingFraction: number; resetTime?: string };
}

function formatQuotaResetTime(
  resetTimeIso?: string,
  defaultFallbackHours = 5,
  isWeekly = false,
): string {
  if (!resetTimeIso) {
    return isWeekly
      ? "将在 7 天后完整重置。"
      : `将在 ${defaultFallbackHours} 小时后刷新。`;
  }
  const date = new Date(resetTimeIso);
  if (isNaN(date.getTime())) {
    return isWeekly
      ? "将在 7 天后完整重置。"
      : `将在 ${defaultFallbackHours} 小时后刷新。`;
  }
  const now = Date.now();
  const diffMs = date.getTime() - now;
  if (diffMs <= 0) {
    return "已到达重置时间，将在下一次请求时刷新。";
  }
  const totalMins = Math.ceil(diffMs / 60_000);
  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (totalMins < 60) {
    return `将于 ${timeStr} 自动刷新 (约 ${totalMins} 分钟后)。`;
  }
  const totalHours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (totalHours < 24) {
    return `将于 ${timeStr} 自动刷新 (约 ${totalHours} 小时${mins > 0 ? ` ${mins} 分钟` : ""}后)。`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return `将在 ${days} 天${remHours > 0 ? ` ${remHours} 小时` : ""}后重置刷新。`;
}

interface ParsedModelOption {
  id: string;
  fullName: string;
  baseName: string;
  tier: "High" | "Medium" | "Low" | "Thinking" | "Default" | null;
  tierDisplay: string;
  supportsImages: boolean;
  isRecommended: boolean;
  quota: number;
}

interface ParsedModelGroup {
  baseName: string;
  items: ParsedModelOption[];
}

interface WorkspaceItem {
  uri: string;
  name: string;
}

interface ConversationItem {
  id: string;
  summary: {
    summary?: string;
    projectName?: string;
    stepCount?: number;
  };
}

interface Props {
  settings: ClientSettings;
  onUpdate: (patch: Partial<ClientSettings>) => void;
  onBack: () => void;
  workspaces?: WorkspaceItem[];
  conversations?: ConversationItem[];
  onSelectProject?: (slug: string) => void;
  onSelectChat?: (id: string) => void;
}

export type SettingsTab =
  // Agent 能力
  | "memory"
  | "plugins"
  | "skills"
  | "subagents"
  | "mcp_servers"
  | "commands"
  | "hooks"
  // 数据与统计
  | "usage_stats"
  // 基础设置
  | "account"
  | "general"
  | "appearance"
  | "models"
  | "browser"
  | "app"
  | "status";

const AGENT_CAPABILITY_TABS: {
  id: SettingsTab;
  label: string;
  mobileLabel: string;
  renderIcon: (size?: number) => React.ReactNode;
}[] = [
  { id: "memory", label: "记忆", mobileLabel: "记忆", renderIcon: (s = 15) => <IconBrain size={s} /> },
  { id: "plugins", label: "插件", mobileLabel: "插件", renderIcon: (s = 15) => <IconPuzzle size={s} /> },
  { id: "skills", label: "技能", mobileLabel: "技能", renderIcon: (s = 15) => <IconWand size={s} /> },
  { id: "subagents", label: "子智能体", mobileLabel: "智能体", renderIcon: (s = 15) => <IconBot size={s} /> },
  { id: "mcp_servers", label: "MCP 服务器", mobileLabel: "MCP", renderIcon: (s = 15) => <IconPlug size={s} /> },
  { id: "commands", label: "命令", mobileLabel: "命令", renderIcon: (s = 15) => <IconCommandPrompt size={s} /> },
  { id: "hooks", label: "钩子", mobileLabel: "钩子", renderIcon: (s = 15) => <IconAnchor size={s} /> },
];

const DATA_STATS_TABS: {
  id: SettingsTab;
  label: string;
  mobileLabel: string;
  renderIcon: (size?: number) => React.ReactNode;
}[] = [
  { id: "usage_stats", label: "使用统计", mobileLabel: "使用统计", renderIcon: (s = 15) => <IconBarChart size={s} /> },
];

const BASIC_SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  mobileLabel: string;
  renderIcon: (size?: number) => React.ReactNode;
}[] = [
  { id: "account", label: "账户设置", mobileLabel: "账户", renderIcon: (s = 15) => <IconUser size={s} /> },
  { id: "general", label: "常规设置", mobileLabel: "常规", renderIcon: (s = 15) => <IconSliders size={s} /> },
  { id: "appearance", label: "外观", mobileLabel: "外观", renderIcon: (s = 15) => <IconPalette size={s} /> },
  { id: "models", label: "模型设置", mobileLabel: "模型", renderIcon: (s = 15) => <IconLayers size={s} /> },
  { id: "browser", label: "浏览器", mobileLabel: "浏览器", renderIcon: (s = 15) => <IconGlobe size={s} /> },
  { id: "app", label: "应用与缓存", mobileLabel: "应用", renderIcon: (s = 15) => <IconMonitor size={s} /> },
];

const ALL_MOBILE_MENU_ITEMS = [
  ...AGENT_CAPABILITY_TABS,
  ...DATA_STATS_TABS,
  ...BASIC_SETTINGS_TABS,
];

export function SettingsPanel({
  settings,
  onUpdate,
  onBack,
  workspaces = [],
  conversations = [],
  onSelectProject,
  onSelectChat,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("memory");
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState<string>(() => getApiBase());
  const [proxyStatus, setProxyStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [healthData, setHealthData] = useState<import("../types").HealthResponse | null>(null);
  const [showSetupWizardLocal, setShowSetupWizardLocal] = useState(false);
  const [playingTestSound, setPlayingTestSound] = useState(false);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  // ── Agent Capabilities State ──
  const [memoryData, setMemoryData] = useState<MemorySummaryResponse | null>(null);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | null>(null);
  const [editMemoryContent, setEditMemoryContent] = useState("");
  const [memorySaveStatus, setMemorySaveStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  const [pluginsList, setPluginsList] = useState<PluginInfo[]>([]);

  const [skillsList, setSkillsList] = useState<SkillDetailedInfo[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "builtin" | "global" | "plugin">("all");
  const [inspectingSkill, setInspectingSkill] = useState<SkillDetailedInfo | null>(null);
  const [skillContent, setSkillContent] = useState<SkillContentResponse | null>(null);
  const [loadingSkillContent, setLoadingSkillContent] = useState(false);

  const [subagentsList, setSubagentsList] = useState<SubagentInfo[]>([]);
  const [expandedSubagent, setExpandedSubagent] = useState<string | null>(null);

  const [mcpServersList, setMcpServersList] = useState<McpServerDetailedInfo[]>([]);
  const [expandedMcpTools, setExpandedMcpTools] = useState<string | null>(null);
  const [openedMcpPath, setOpenedMcpPath] = useState<string | null>(null);
  const [copiedMcpPath, setCopiedMcpPath] = useState<string | null>(null);

  const [commandsList, setCommandsList] = useState<CommandDefinition[]>([]);
  const [commandSearch, setCommandSearch] = useState("");
  const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [commandSubView, setCommandSubView] = useState<"list" | "form">("list");
  const [editingCommand, setEditingCommand] = useState<CommandDefinition | null>(null);
  const [cmdFormName, setCmdFormName] = useState("");
  const [cmdFormScope, setCmdFormScope] = useState<"user" | "workspace">("user");
  const [cmdFormDesc, setCmdFormDesc] = useState("");
  const [cmdFormArgHint, setCmdFormArgHint] = useState("");
  const [cmdFormPrompt, setCmdFormPrompt] = useState("");
  const [cmdFormSaving, setCmdFormSaving] = useState(false);

  const [openedAgentPath, setOpenedAgentPath] = useState<string | null>(null);
  const [copiedAgentPath, setCopiedAgentPath] = useState<string | null>(null);
  const [subagentViewMode, setSubagentViewMode] = useState<"compact" | "cards">("compact");
  const [subagentFilter, setSubagentFilter] = useState<"all" | "builtin" | "plugin" | "custom">("all");
  const [subagentSearch, setSubagentSearch] = useState("");
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [editingAgent, setEditingAgent] = useState<SubagentInfo | null>(null);
  const [agentFormName, setAgentFormName] = useState("");
  const [agentFormRole, setAgentFormRole] = useState("");
  const [agentFormDesc, setAgentFormDesc] = useState("");
  const [agentFormTools, setAgentFormTools] = useState<string[]>([
    "read_file",
    "write_to_file",
    "run_command",
    "grep_search",
    "view_file",
  ]);
  const [agentFormPrompt, setAgentFormPrompt] = useState("");
  const [agentFormSaving, setAgentFormSaving] = useState(false);

  const [hooksList, setHooksList] = useState<HookDefinition[]>([]);
  const [hookSubView, setHookSubView] = useState<"list" | "form">("list");
  const [editingHook, setEditingHook] = useState<HookDefinition | null>(null);
  const [hookFormScope, setHookFormScope] = useState<"user" | "workspace">("user");
  const [hookFormEvent, setHookFormEvent] = useState<
    "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop"
  >("PreToolUse");
  const [hookFormRunType, setHookFormRunType] = useState<string>("command");
  const [hookFormMatcher, setHookFormMatcher] = useState<string>("");
  const [hookFormCommand, setHookFormCommand] = useState<string>("");
  const [hookFormArgs, setHookFormArgs] = useState<string>("");
  const [hookFormName, setHookFormName] = useState<string>("");
  const [hookFormTimeout, setHookFormTimeout] = useState<number>(30);
  const [hookFormShowAdvanced, setHookFormShowAdvanced] = useState<boolean>(false);
  const [hookFormSaving, setHookFormSaving] = useState<boolean>(false);
  const [hookSearchQuery, setHookSearchQuery] = useState<string>("");
  const [hookScopeFilter, setHookScopeFilter] = useState<"all" | "user" | "workspace">("all");

  const disabledSkills = useMemo(() => new Set(settings.disabledSkills ?? []), [settings.disabledSkills]);
  const disabledMcpTools = useMemo(() => new Set(settings.disabledMcpTools ?? []), [settings.disabledMcpTools]);
  const disabledCommands = useMemo(() => new Set(settings.disabledCommands ?? []), [settings.disabledCommands]);

  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const [userEmail, setUserEmail] = useState<string>("");
  const [quotaSummary, setQuotaSummary] = useState<UserQuotaSummary | null>(() => {
    return getCachedQuotaSummary();
  });
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);
  const [quotaLastRefreshed, setQuotaLastRefreshed] = useState<Date | null>(null);
  const [quotaRefreshSuccess, setQuotaRefreshSuccess] = useState(false);

  const isMountedRef = useRef(true);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const fetchCapabilities = useCallback(async () => {
    try {
      const [mem, plugs, sks, subs, mcps, cmds, hks] = await Promise.allSettled([
        api.agentCapabilities.memory(workspaces[0]?.uri),
        api.agentCapabilities.plugins(),
        api.agentCapabilities.skills(),
        api.agentCapabilities.subagents(),
        api.agentCapabilities.mcp(),
        api.agentCapabilities.commands(),
        api.agentCapabilities.hooks(workspaces[0]?.uri),
      ]);

      if (!isMountedRef.current) return;

      if (mem.status === "fulfilled" && mem.value) setMemoryData(mem.value);
      if (plugs.status === "fulfilled" && plugs.value?.plugins) setPluginsList(plugs.value.plugins);
      if (sks.status === "fulfilled" && sks.value?.skills) setSkillsList(sks.value.skills);
      if (subs.status === "fulfilled" && subs.value?.subagents) setSubagentsList(subs.value.subagents);
      if (mcps.status === "fulfilled" && mcps.value?.servers) setMcpServersList(mcps.value.servers);
      if (cmds.status === "fulfilled" && cmds.value?.commands) {
        const cmdList = cmds.value.commands;
        setCommandsList(cmdList);
        const serverDisabled = cmdList.filter((c) => c.enabled === false).map((c) => c.cmd);
        if (serverDisabled.length > 0) {
          const currentList = settings.disabledCommands ?? [];
          const merged = Array.from(new Set([...currentList, ...serverDisabled]));
          if (merged.length !== currentList.length) {
            onUpdate({ disabledCommands: merged });
          }
        }
      }
      if (hks.status === "fulfilled" && hks.value?.hooks) setHooksList(hks.value.hooks);
    } catch (err) {
      console.warn("Failed to fetch capabilities:", err);
    }
  }, [workspaces]);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.health();
      if (!isMountedRef.current) return;
      setHealthData(data);
    } catch (err) {
      console.warn("Failed to fetch health:", err);
    }
  }, []);

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
        if (!isMountedRef.current) return;
        setModels(data.clientModelConfigs ?? []);
        return;
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
  }, []);

  const fetchUserStatus = useCallback(async () => {
    try {
      const [data, quotaData] = await Promise.all([
        api.userStatus().catch(() => null),
        api.quota().catch(() => null),
      ]);
      if (!isMountedRef.current) return;
      if (data?.userStatus?.email) setUserEmail(data.userStatus.email);
      const summary =
        (quotaData?.groups && quotaData.groups.length > 0 ? quotaData : null) ??
        data?.userQuotaSummary ??
        data?.userStatus?.userQuotaSummary ??
        (data as any)?.planStatus?.userQuotaSummary;
      if (summary?.groups && summary.groups.length > 0) {
        setQuotaSummary(summary);
        setCachedQuotaSummary(summary);
      }
    } catch (err) {
      console.warn("Failed to fetch user status / quota:", err);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchModels();
    fetchUserStatus();
    fetchHealth();
    fetchCapabilities();

    const timer = setInterval(() => {
      fetchHealth();
      fetchCapabilities();
    }, 4000);

    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchModels, fetchUserStatus, fetchHealth, fetchCapabilities]);

  useEffect(() => {
    if (activeTabRef.current && typeof activeTabRef.current.scrollIntoView === "function") {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeTab]);

  // ── Toggle Handlers ──
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);

  const togglePlugin = useCallback(async (pluginId: string, currentEnabled: boolean) => {
    const next = !currentEnabled;
    try {
      await api.agentCapabilities.togglePlugin(pluginId, next);
      setPluginsList((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled: next } : p)),
      );
      flashSaved();
    } catch (err) {
      console.error("Failed to toggle plugin:", err);
    }
  }, [flashSaved]);

  const handleInstallPlugin = useCallback(async (pluginId: string) => {
    setInstallingPluginId(pluginId);
    try {
      await api.agentCapabilities.installPlugin(pluginId);
      await fetchCapabilities();
      flashSaved();
    } catch (err) {
      console.error("Failed to install plugin:", err);
    } finally {
      setInstallingPluginId(null);
    }
  }, [fetchCapabilities, flashSaved]);

  const handleUninstallPlugin = useCallback(async (pluginId: string, displayName: string) => {
    if (!window.confirm(`确定要卸载/删除扩展插件「${displayName}」吗？`)) return;
    setInstallingPluginId(pluginId);
    try {
      await api.agentCapabilities.uninstallPlugin(pluginId);
      await fetchCapabilities();
      flashSaved();
    } catch (err) {
      console.error("Failed to uninstall plugin:", err);
    } finally {
      setInstallingPluginId(null);
    }
  }, [fetchCapabilities, flashSaved]);

  const toggleSkill = useCallback((skillName: string) => {
    const next = new Set(disabledSkills);
    if (next.has(skillName)) {
      next.delete(skillName);
    } else {
      next.add(skillName);
    }
    onUpdate({ disabledSkills: Array.from(next) });
    flashSaved();
  }, [disabledSkills, onUpdate, flashSaved]);

  const toggleMcpServer = useCallback(async (serverName: string, currentDisabled: boolean) => {
    const nextDisabled = !currentDisabled;
    try {
      await api.agentCapabilities.toggleMcp(serverName, nextDisabled);
      setMcpServersList((prev) =>
        prev.map((s) => (s.name === serverName ? { ...s, disabled: nextDisabled } : s)),
      );
      const nextTools = new Set(disabledMcpTools);
      if (nextDisabled) {
        nextTools.add(serverName);
      } else {
        nextTools.delete(serverName);
      }
      onUpdate({ disabledMcpTools: Array.from(nextTools) });
      flashSaved();
    } catch (err) {
      console.error("Failed to toggle MCP server:", err);
    }
  }, [disabledMcpTools, onUpdate, flashSaved]);

  const inspectSkill = useCallback(async (skill: SkillDetailedInfo) => {
    setInspectingSkill(skill);
    setLoadingSkillContent(true);
    try {
      const data = await api.agentCapabilities.skillContent(skill.path);
      setSkillContent(data);
    } catch {
      setSkillContent({ markdown: "无法加载技能文档", scripts: [], references: [] });
    } finally {
      setLoadingSkillContent(false);
    }
  }, []);

  const handleSaveMemory = useCallback(async () => {
    if (!editingMemory) return;
    setMemorySaveStatus("saving");
    try {
      await api.agentCapabilities.saveMemory(editingMemory.path, editMemoryContent);
      setMemorySaveStatus("ok");
      flashSaved();
      fetchCapabilities();
      setTimeout(() => {
        setMemorySaveStatus("idle");
        setEditingMemory(null);
      }, 1200);
    } catch {
      setMemorySaveStatus("error");
      setTimeout(() => setMemorySaveStatus("idle"), 2500);
    }
  }, [editingMemory, editMemoryContent, flashSaved, fetchCapabilities]);

  const handleCopyCommand = useCallback((cmd: string) => {
    try {
      navigator.clipboard.writeText(cmd);
      triggerHaptic("light");
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {}
  }, []);

  // ── Quota data parsing ──
  const quotaData = useMemo(() => {
    if (quotaSummary?.groups && quotaSummary.groups.length > 0) {
      const geminiGroup = quotaSummary.groups.find((g) => /gemini/i.test(g.displayName));
      const geminiWeekly = geminiGroup?.buckets?.find((b) => b.bucketId === "gemini-weekly" || b.window === "weekly");
      const gemini5h = geminiGroup?.buckets?.find((b) => b.bucketId === "gemini-5h" || b.window === "5h");

      const partnerGroup = quotaSummary.groups.find((g) => /claude|gpt|3p/i.test(g.displayName));
      const partnerWeekly = partnerGroup?.buckets?.find((b) => b.bucketId === "3p-weekly" || b.window === "weekly");
      const partner5h = partnerGroup?.buckets?.find((b) => b.bucketId === "3p-5h" || b.window === "5h");

      return {
        geminiGroupName: geminiGroup?.displayName || "Gemini Models",
        geminiGroupDesc: geminiGroup?.description || "Models within this group: Gemini Flash, Gemini Pro",
        geminiWeeklyPct: geminiWeekly?.remainingFraction !== undefined ? Math.round(geminiWeekly.remainingFraction * 100) : 100,
        geminiWeeklyFraction: geminiWeekly?.remainingFraction ?? 1.0,
        geminiWeeklyDesc: geminiWeekly?.description,
        geminiWeeklyReset: geminiWeekly?.resetTime,

        gemini5hPct: gemini5h?.remainingFraction !== undefined ? Math.round(gemini5h.remainingFraction * 100) : 100,
        gemini5hFraction: gemini5h?.remainingFraction ?? 1.0,
        gemini5hDesc: gemini5h?.description,
        gemini5hReset: gemini5h?.resetTime,

        claudeGroupName: partnerGroup?.displayName || "Claude and GPT models",
        claudeGroupDesc: partnerGroup?.description || "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
        claudeWeeklyPct: partnerWeekly?.remainingFraction !== undefined ? Math.round(partnerWeekly.remainingFraction * 100) : 100,
        claudeWeeklyFraction: partnerWeekly?.remainingFraction ?? 1.0,
        claudeWeeklyDesc: partnerWeekly?.description,
        claudeWeeklyReset: partnerWeekly?.resetTime,

        claude5hPct: partner5h?.remainingFraction !== undefined ? Math.round(partner5h.remainingFraction * 100) : 100,
        claude5hFraction: partner5h?.remainingFraction ?? 1.0,
        claude5hDesc: partner5h?.description,
        claude5hReset: partner5h?.resetTime,
      };
    }

    // Fallback using model configs
    const geminiConfigs = models.filter(
      (c) =>
        /gemini/i.test(c.modelOrAlias?.model || "") ||
        /gemini/i.test(c.label || ""),
    );
    const primaryGemini =
      geminiConfigs.find((c) => c.label?.includes("3.7")) ??
      geminiConfigs.find((c) => c.label?.includes("3.6")) ??
      geminiConfigs[0];
    const gemini5hFraction = primaryGemini?.quotaInfo?.remainingFraction ?? 1.0;
    const gemini5hReset = primaryGemini?.quotaInfo?.resetTime;

    const fractions = geminiConfigs
      .map((c) => c.quotaInfo?.remainingFraction)
      .filter((f): f is number => typeof f === "number");
    const geminiWeeklyFraction = fractions.length > 0 ? Math.min(...fractions) : 1.0;

    const partnerConfigs = models.filter(
      (c) =>
        /claude|gpt|anthropic|openai/i.test(c.modelOrAlias?.model || "") ||
        /claude|gpt|anthropic|openai/i.test(c.label || ""),
    );
    const primaryPartner =
      partnerConfigs.find((c) => c.label?.includes("Sonnet")) ??
      partnerConfigs.find((c) => c.label?.includes("120B")) ??
      partnerConfigs[0];
    const partner5hFraction = primaryPartner?.quotaInfo?.remainingFraction ?? 1.0;
    const partner5hReset = primaryPartner?.quotaInfo?.resetTime;
    const partnerFractions = partnerConfigs
      .map((c) => c.quotaInfo?.remainingFraction)
      .filter((f): f is number => typeof f === "number");
    const partnerWeeklyFraction = partnerFractions.length > 0 ? Math.min(...partnerFractions) : 1.0;

    return {
      geminiGroupName: "Gemini Models",
      geminiGroupDesc: "Models within this group: Gemini Flash, Gemini Pro",
      geminiWeeklyPct: Math.round(geminiWeeklyFraction * 100),
      geminiWeeklyFraction,
      geminiWeeklyDesc: undefined,
      geminiWeeklyReset: undefined,
      gemini5hPct: Math.round(gemini5hFraction * 100),
      gemini5hFraction,
      gemini5hDesc: undefined,
      gemini5hReset: gemini5hReset,

      claudeGroupName: "Claude and GPT models",
      claudeGroupDesc: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
      claudeWeeklyPct: Math.round(partnerWeeklyFraction * 100),
      claudeWeeklyFraction: partnerWeeklyFraction,
      claudeWeeklyDesc: undefined,
      claudeWeeklyReset: undefined,
      claude5hPct: Math.round(partner5hFraction * 100),
      claude5hFraction: partner5hFraction,
      claude5hDesc: undefined,
      claude5hReset: partner5hReset,
    };
  }, [quotaSummary, models]);

  const modelGroups = useMemo<ParsedModelGroup[]>(() => {
    const map = new Map<string, ParsedModelOption[]>();
    const seenValues = new Set<string>();

    for (const m of models) {
      if (!m.modelOrAlias?.model) continue;
      const label = m.label || m.modelOrAlias?.model || "";
      const match = label.match(/^(.*?)(?:\s*\((Low|Medium|High|Thinking|低|中|高|思考|Default|标准)\))?$/i);
      const baseName = match ? match[1].trim() : label.trim();
      const rawTier = match && match[2] ? match[2].trim() : null;
      let tier: ParsedModelOption["tier"] = null;
      let tierDisplay = "标准模式";
      if (rawTier) {
        if (rawTier === "高" || rawTier.toLowerCase() === "high") {
          tier = "High";
          tierDisplay = "High (高思考)";
        } else if (rawTier === "中" || rawTier.toLowerCase() === "medium") {
          tier = "Medium";
          tierDisplay = "Medium (中思考)";
        } else if (rawTier === "低" || rawTier.toLowerCase() === "low") {
          tier = "Low";
          tierDisplay = "Low (低思考)";
        } else if (rawTier === "思考" || rawTier.toLowerCase() === "thinking") {
          tier = "Thinking";
          tierDisplay = "Thinking (深度思考)";
        } else {
          tier = "Default";
          tierDisplay = "Default (标准)";
        }
      }

      const id = m.modelOrAlias.model;
      // Prevent duplicate values in the dropdown
      if (seenValues.has(id)) continue;
      seenValues.add(id);

      const item: ParsedModelOption = {
        id,
        fullName: label,
        baseName,
        tier,
        tierDisplay,
        supportsImages: !!m.supportsImages,
        isRecommended: !!m.isRecommended,
        quota: m.quotaInfo?.remainingFraction ?? 1.0,
      };

      if (!map.has(baseName)) {
        map.set(baseName, []);
      }
      map.get(baseName)!.push(item);
    }

    const tierOrder: Record<string, number> = {
      high: 1,
      medium: 2,
      low: 3,
      thinking: 4,
      default: 5,
    };

    const getScore = (name: string) => {
      let score = 0;
      const n = name.toLowerCase();
      if (n.includes("3.7")) score += 10000;
      else if (n.includes("3.6")) score += 8000;
      else if (n.includes("3.5")) score += 6000;
      else if (n.includes("3.1")) score += 4000;
      if (n.includes("gemini")) score += 2000;
      else if (n.includes("claude") || n.includes("sonnet") || n.includes("opus")) score += 1500;
      else if (n.includes("gpt") || n.includes("openai")) score += 1000;
      else if (n.includes("deepseek")) score += 800;
      return score;
    };

    const groups: ParsedModelGroup[] = [];
    for (const [baseName, items] of map.entries()) {
      items.sort((a, b) => {
        const orderA = a.tier ? (tierOrder[a.tier.toLowerCase()] ?? 99) : 99;
        const orderB = b.tier ? (tierOrder[b.tier.toLowerCase()] ?? 99) : 99;
        return orderA - orderB;
      });
      groups.push({ baseName, items });
    }

    groups.sort((a, b) => getScore(b.baseName) - getScore(a.baseName));
    return groups;
  }, [models]);

  const modelSelectGroups = useMemo(() => {
    return modelGroups.map((group) => ({
      groupLabel: group.baseName,
      options: group.items.map((m) => ({
        value: m.id,
        label: m.tier ? `${group.baseName} (${m.tierDisplay})` : m.fullName,
      })),
    }));
  }, [modelGroups]);

  const handleRefreshQuota = useCallback(async () => {
    setQuotaRefreshing(true);
    try {
      await Promise.all([fetchModels(1), fetchUserStatus()]);
      setQuotaLastRefreshed(new Date());
      setQuotaRefreshSuccess(true);
      flashSaved();
      setTimeout(() => {
        if (isMountedRef.current) setQuotaRefreshSuccess(false);
      }, 2500);
    } catch (err) {
      console.warn("Failed to refresh quota:", err);
    } finally {
      if (isMountedRef.current) setQuotaRefreshing(false);
    }
  }, [fetchModels, fetchUserStatus, flashSaved]);

  const filteredSkills = useMemo(() => {
    return skillsList.filter((s) => {
      const matchSearch =
        !skillSearch ||
        s.name.toLowerCase().includes(skillSearch.toLowerCase()) ||
        s.title.toLowerCase().includes(skillSearch.toLowerCase()) ||
        s.description.toLowerCase().includes(skillSearch.toLowerCase());
      const matchFilter = skillFilter === "all" || s.source === skillFilter;
      return matchSearch && matchFilter;
    });
  }, [skillsList, skillSearch, skillFilter]);

  const filteredCommands = useMemo(() => {
    if (!commandSearch.trim()) return commandsList;
    const q = commandSearch.trim().toLowerCase();
    return commandsList.filter((c) => {
      return (
        c.cmd.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.argumentHint && c.argumentHint.toLowerCase().includes(q)) ||
        (c.pluginName && c.pluginName.toLowerCase().includes(q)) ||
        (c.dirPath && c.dirPath.toLowerCase().includes(q)) ||
        (c.path && c.path.toLowerCase().includes(q))
      );
    });
  }, [commandsList, commandSearch]);

  const openNewCommandModal = useCallback(() => {
    setEditingCommand(null);
    setCmdFormName("");
    setCmdFormScope("user");
    setCmdFormDesc("");
    setCmdFormArgHint("");
    setCmdFormPrompt("");
    setCommandSubView("form");
  }, []);

  const openEditCommand = useCallback((c: CommandDefinition) => {
    setEditingCommand(c);
    setCmdFormName(c.name || c.cmd.replace(/^\//, ""));
    setCmdFormScope(c.source === "workspace" ? "workspace" : "user");
    setCmdFormDesc(c.description || "");
    setCmdFormArgHint(c.argumentHint || "");
    setCmdFormPrompt(c.fullPrompt || c.promptSnippet || "");
    setCommandSubView("form");
  }, []);

  const handleSaveCommand = useCallback(async () => {
    const rawName = cmdFormName.trim();
    if (!rawName || !cmdFormPrompt.trim()) return;
    setCmdFormSaving(true);
    try {
      const cleanCmd = rawName.startsWith("/") ? rawName : `/${rawName}`;
      if (editingCommand && editingCommand.path) {
        await api.agentCapabilities.updateCommand({
          path: editingCommand.path,
          name: rawName,
          cmd: cleanCmd,
          description: cmdFormDesc.trim(),
          argumentHint: cmdFormArgHint.trim(),
          usage: cmdFormArgHint.trim() ? `${cleanCmd} ${cmdFormArgHint.trim()}` : cleanCmd,
          prompt: cmdFormPrompt.trim(),
        });
      } else {
        await api.agentCapabilities.createCommand({
          name: rawName,
          cmd: cleanCmd,
          description: cmdFormDesc.trim(),
          argumentHint: cmdFormArgHint.trim(),
          scope: cmdFormScope,
          usage: cmdFormArgHint.trim() ? `${cleanCmd} ${cmdFormArgHint.trim()}` : cleanCmd,
          prompt: cmdFormPrompt.trim(),
        });
      }
      setCommandSubView("list");
      setEditingCommand(null);
      await fetchCapabilities();
      flashSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setCmdFormSaving(false);
    }
  }, [cmdFormName, cmdFormPrompt, cmdFormDesc, cmdFormArgHint, cmdFormScope, editingCommand, fetchCapabilities, flashSaved]);

  const handleDeleteCommand = useCallback(async (cmd: CommandDefinition) => {
    if (!cmd.path) return;
    if (!confirm(`确定要删除自定义指令「${cmd.cmd}」吗？该操作不可撤销。`)) return;
    try {
      await api.agentCapabilities.deleteCommand(cmd.path);
      await fetchCapabilities();
      flashSaved();
    } catch (e) {
      console.error(e);
    }
  }, [fetchCapabilities, flashSaved]);

  const handleToggleCommand = useCallback(
    async (cmd: string, enabled: boolean) => {
      const cleanCmd = cmd.startsWith("/") ? cmd : `/${cmd}`;
      const rawCmd = cleanCmd.slice(1);
      const next = new Set(disabledCommands);
      if (enabled) {
        next.delete(cleanCmd);
        next.delete(rawCmd);
      } else {
        next.add(cleanCmd);
        next.add(rawCmd);
      }
      onUpdate({ disabledCommands: Array.from(next) });
      flashSaved();
      try {
        await api.agentCapabilities.toggleCommand(cleanCmd, enabled);
      } catch (e) {
        console.error("Failed to toggle command:", e);
      }
    },
    [disabledCommands, onUpdate, flashSaved]
  );

  const openNewHookForm = useCallback(() => {
    setEditingHook(null);
    setHookFormScope("user");
    setHookFormEvent("PreToolUse");
    setHookFormRunType("command");
    setHookFormMatcher("");
    setHookFormCommand("");
    setHookFormArgs("");
    setHookFormName("");
    setHookFormTimeout(30);
    setHookFormShowAdvanced(false);
    setHookSubView("form");
  }, []);

  const openEditHookForm = useCallback((h: HookDefinition) => {
    setEditingHook(h);
    setHookFormScope(h.source === "workspace" ? "workspace" : "user");
    setHookFormEvent(h.event);
    setHookFormRunType(h.runType || "command");
    setHookFormMatcher(h.matcher || "");
    setHookFormCommand(h.command || "");
    setHookFormArgs(Array.isArray(h.args) ? h.args.join("\n") : "");
    setHookFormName(h.name || "");
    setHookFormTimeout(h.timeout || 30);
    setHookFormShowAdvanced(false);
    setHookSubView("form");
  }, []);

  const handleSaveHook = useCallback(async () => {
    if (!hookFormCommand.trim()) return;
    setHookFormSaving(true);
    try {
      const parsedArgs = hookFormArgs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (editingHook) {
        await api.agentCapabilities.updateHook({
          name: hookFormName.trim() || editingHook.name,
          originalName: editingHook.name,
          event: hookFormEvent,
          originalEvent: editingHook.event,
          scope: hookFormScope,
          workspaceUri: workspaces[0]?.uri,
          filePath: editingHook.filePath,
          runType: hookFormRunType,
          matcher: hookFormMatcher.trim() || undefined,
          command: hookFormCommand.trim(),
          args: parsedArgs.length > 0 ? parsedArgs : undefined,
          timeout: Number(hookFormTimeout) || 30,
          enabled: editingHook.enabled,
        });
      } else {
        await api.agentCapabilities.createHook({
          name: hookFormName.trim() || undefined,
          event: hookFormEvent,
          scope: hookFormScope,
          workspaceUri: workspaces[0]?.uri,
          runType: hookFormRunType,
          matcher: hookFormMatcher.trim() || undefined,
          command: hookFormCommand.trim(),
          args: parsedArgs.length > 0 ? parsedArgs : undefined,
          timeout: Number(hookFormTimeout) || 30,
          enabled: true,
        });
      }

      setHookSubView("list");
      setEditingHook(null);
      await fetchCapabilities();
      flashSaved();
    } catch (err) {
      console.error("Failed to save hook:", err);
    } finally {
      setHookFormSaving(false);
    }
  }, [
    hookFormCommand,
    hookFormArgs,
    editingHook,
    hookFormName,
    hookFormEvent,
    hookFormScope,
    workspaces,
    hookFormRunType,
    hookFormMatcher,
    hookFormTimeout,
    fetchCapabilities,
    flashSaved,
  ]);

  const handleToggleHook = useCallback(
    async (h: HookDefinition) => {
      const nextEnabled = !h.enabled;
      setHooksList((prev) =>
        prev.map((item) => (item.id === h.id ? { ...item, enabled: nextEnabled } : item))
      );
      try {
        await api.agentCapabilities.toggleHook({
          name: h.name,
          filePath: h.filePath,
          scope: h.source === "workspace" ? "workspace" : "user",
          workspaceUri: workspaces[0]?.uri,
          enabled: nextEnabled,
        });
        flashSaved();
      } catch (err) {
        console.error("Failed to toggle hook:", err);
        setHooksList((prev) =>
          prev.map((item) => (item.id === h.id ? { ...item, enabled: !nextEnabled } : item))
        );
      }
    },
    [workspaces, flashSaved]
  );

  const handleDeleteHook = useCallback(
    async (h: HookDefinition) => {
      if (!confirm(`确定要删除钩子「${h.name}」吗？`)) return;
      try {
        await api.agentCapabilities.deleteHook({
          name: h.name,
          event: h.event,
          filePath: h.filePath,
          scope: h.source === "workspace" ? "workspace" : "user",
          workspaceUri: workspaces[0]?.uri,
        });
        setHooksList((prev) => prev.filter((item) => item.id !== h.id));
        flashSaved();
      } catch (err) {
        console.error("Failed to delete hook:", err);
      }
    },
    [workspaces, flashSaved]
  );

  const filteredAndGroupedHooks = useMemo(() => {
    const q = hookSearchQuery.trim().toLowerCase();
    const list = hooksList.filter((h) => {
      if (hookScopeFilter === "user" && h.source !== "config" && h.source !== "plugin") {
        return false;
      }
      if (hookScopeFilter === "workspace" && h.source !== "workspace") {
        return false;
      }
      if (q) {
        const nameMatch = h.name.toLowerCase().includes(q);
        const cmdMatch = h.command.toLowerCase().includes(q);
        const matcherMatch = h.matcher ? h.matcher.toLowerCase().includes(q) : false;
        const eventMatch = h.event.toLowerCase().includes(q);
        if (!nameMatch && !cmdMatch && !matcherMatch && !eventMatch) return false;
      }
      return true;
    });

    const eventOrder: Array<"Stop" | "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation"> = [
      "Stop",
      "PreToolUse",
      "PostToolUse",
      "PreInvocation",
      "PostInvocation",
    ];

    const groups: Array<{ event: string; hooks: HookDefinition[] }> = [];
    for (const ev of eventOrder) {
      const items = list.filter((h) => h.event === ev);
      if (items.length > 0) {
        groups.push({ event: ev, hooks: items });
      }
    }

    const otherEvents = Array.from(new Set(list.map((h) => h.event))).filter(
      (ev) => !eventOrder.includes(ev as any)
    );
    for (const ev of otherEvents) {
      const items = list.filter((h) => h.event === ev);
      if (items.length > 0) {
        groups.push({ event: ev, hooks: items });
      }
    }

    return { total: list.length, groups };
  }, [hooksList, hookScopeFilter, hookSearchQuery]);

  const filteredSubagents = useMemo(() => {
    return subagentsList.filter((a) => {
      if (subagentFilter !== "all" && a.source !== subagentFilter) return false;
      if (!subagentSearch.trim()) return true;
      const q = subagentSearch.trim().toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        (a.pluginName && a.pluginName.toLowerCase().includes(q))
      );
    });
  }, [subagentsList, subagentFilter, subagentSearch]);

  const openNewAgentModal = useCallback(() => {
    setEditingAgent(null);
    setAgentFormName("");
    setAgentFormRole("");
    setAgentFormDesc("");
    setAgentFormTools(["read_file", "write_to_file", "run_command", "grep_search", "view_file"]);
    setAgentFormPrompt("You are a specialized subagent.");
    setShowAgentEditor(true);
  }, []);

  const handleSaveAgent = useCallback(async () => {
    if (!agentFormName.trim()) return;
    setAgentFormSaving(true);
    try {
      if (editingAgent && editingAgent.path) {
        await api.agentCapabilities.updateSubagent({
          path: editingAgent.path,
          name: agentFormName.trim(),
          role: agentFormRole.trim(),
          description: agentFormDesc.trim(),
          tools: agentFormTools,
          systemPrompt: agentFormPrompt.trim(),
        });
      } else {
        await api.agentCapabilities.createSubagent({
          name: agentFormName.trim(),
          role: agentFormRole.trim(),
          description: agentFormDesc.trim(),
          tools: agentFormTools,
          systemPrompt: agentFormPrompt.trim(),
        });
      }
      setShowAgentEditor(false);
      setEditingAgent(null);
      await fetchCapabilities();
      flashSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setAgentFormSaving(false);
    }
  }, [agentFormName, agentFormRole, agentFormDesc, agentFormTools, agentFormPrompt, editingAgent, fetchCapabilities, flashSaved]);

  const handleDeleteAgent = useCallback(async (agent: SubagentInfo) => {
    if (!agent.path) return;
    if (!confirm(`确定要删除自定义智能体「${agent.name}」吗？`)) return;
    try {
      await api.agentCapabilities.deleteSubagent(agent.path);
      await fetchCapabilities();
      flashSaved();
    } catch (e) {
      console.error(e);
    }
  }, [fetchCapabilities, flashSaved]);

  const displayedProjects = showAllProjects ? workspaces : workspaces.slice(0, 4);

  return (
    <>
      <div className="settings-panel">
        {/* ── Mobile Navigation Header ── */}
        <div className="settings-mobile-header">
          <button className="settings-mobile-back-btn" onClick={onBack}>
            <IconChevronLeft size={16} />
            <span>返回</span>
          </button>
          <div className="settings-mobile-header-right">
            {savedFlash && <span className="settings-saved-badge">✓ 已保存</span>}
            <button className="settings-close-btn" onClick={onBack} aria-label="关闭">
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* ── Mobile Horizontally Scrollable Tab Bar ── */}
        <div className="settings-mobile-tabs-container">
          <div className="settings-mobile-tabs-scroll">
            {ALL_MOBILE_MENU_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  ref={isActive ? activeTabRef : null}
                  className={`settings-mobile-tab-btn ${isActive ? "active" : ""}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span className="settings-mobile-tab-icon">{item.renderIcon(13)}</span>
                  <span>{item.mobileLabel}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Desktop Left Sidebar (>=769px) ── */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-top">
            <button className="settings-back-btn" onClick={onBack} title="返回工作区">
              <IconChevronLeft size={15} />
              <span>返回工作区</span>
            </button>

            {/* Section: Agent Capabilities (Matching screenshot exactly) */}
            <div className="settings-nav-group">
              <div className="settings-group-header">Agent 能力</div>
              <nav className="settings-nav">
                {AGENT_CAPABILITY_TABS.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`settings-nav-item ${isActive ? "active" : ""}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span className="settings-nav-icon">{item.renderIcon(15)}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Section: Basic Settings */}
            <div className="settings-nav-group">
              <div className="settings-group-header">基础设置</div>
              <nav className="settings-nav">
                {BASIC_SETTINGS_TABS.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`settings-nav-item ${isActive ? "active" : ""}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span className="settings-nav-icon">{item.renderIcon(15)}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Section: 数据与统计 */}
            <div className="settings-nav-group">
              <div className="settings-group-header">数据与统计</div>
              <nav className="settings-nav">
                {DATA_STATS_TABS.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`settings-nav-item ${isActive ? "active" : ""}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span className="settings-nav-icon">{item.renderIcon(15)}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Section: Projects */}
            {workspaces.length > 0 && (
              <div className="settings-nav-group">
                <div className="settings-group-header">工作区项目</div>
                <div className="settings-nav">
                  {displayedProjects.map((ws) => (
                    <button
                      key={ws.uri}
                      className="settings-nav-item project-item"
                      onClick={() => {
                        onSelectProject?.(ws.name);
                        onBack();
                      }}
                    >
                      <span className="settings-nav-icon">
                        <IconFolder size={14} />
                      </span>
                      <span className="project-name-text">{ws.name}</span>
                    </button>
                  ))}
                  {workspaces.length > 4 && (
                    <button
                      className="settings-nav-item show-all-btn"
                      onClick={() => setShowAllProjects((v) => !v)}
                    >
                      <span>{showAllProjects ? "收起" : "展开全部"}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Section: Recent Conversations */}
            {conversations.length > 0 && onSelectChat && (
              <div className="settings-nav-group">
                <div className="settings-group-header">最近会话</div>
                <div className="settings-nav">
                  {conversations.slice(0, 3).map((chat) => (
                    <button
                      key={chat.id}
                      className="settings-nav-item project-item"
                      onClick={() => {
                        onSelectChat(chat.id);
                        onBack();
                      }}
                    >
                      <span className="settings-nav-icon">
                        <IconMessageSquare size={13} />
                      </span>
                      <span className="project-name-text">
                        {chat.summary?.projectName || chat.summary?.summary || chat.id.slice(0, 8)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="settings-sidebar-bottom">
            <button
              className="settings-quick-link guide-style"
              onClick={() => setShowShortcutsModal(true)}
              title="快捷键指南"
            >
              <IconKeyboard size={14} />
              <span>快捷键指南</span>
            </button>
            <button
              className="settings-quick-link"
              onClick={() => setShowFeedbackModal(true)}
              title="意见与反馈"
            >
              <IconMessageSquare size={14} />
              <span>意见与反馈</span>
            </button>
          </div>
        </div>

        {/* ── Right Content Area ── */}
        <div className="settings-content">
          <div className="settings-content-inner">
            {!(activeTab === "commands" && commandSubView === "form") && activeTab !== "hooks" && activeTab !== "usage_stats" && (
            <div className="settings-content-header">
              <div>
                <h1 className="settings-main-title">
                  {activeTab === "memory" && "记忆 (Memory)"}
                  {activeTab === "plugins" && "插件 (Plugins)"}
                  {activeTab === "skills" && "技能 (Skills)"}
                  {activeTab === "subagents" && "子智能体 (Subagents)"}
                  {activeTab === "mcp_servers" && "MCP 服务器 (MCP Servers)"}
                  {activeTab === "commands" && "命令 (Commands)"}
                  {activeTab === "account" && "账户设置"}
                  {activeTab === "general" && "常规设置"}
                  {activeTab === "appearance" && "主题外观"}
                  {activeTab === "models" && "模型与用量"}
                  {activeTab === "browser" && "浏览器控制"}
                  {activeTab === "app" && "应用与离线缓存"}
                  {activeTab === "status" && "服务与节点状态"}
                </h1>
                <p className="settings-subtitle">
                  {activeTab === "memory" && "全局指令 (GEMINI.md)、工作区规则与跨会话长效记忆管理。"}
                  {activeTab === "plugins" && "管理已安装的 Antigravity 扩展包及其内置的技能、工具与规则。"}
                  {activeTab === "skills" && "查看与配置内置超级技能库、全局技能及插件扩展技能。"}
                  {activeTab === "subagents" && "专业子智能体分工、可用工具权限与系统提示词配置。"}
                  {activeTab === "mcp_servers" && "Model Context Protocol 服务集成、Stdio/SSE 管道与工具列表。"}
                  {activeTab === "commands" && "斜杠指令集与插件自定义快捷指令，随时调用专属模式。"}
                  {activeTab === "account" && "管理您的订阅方案、开发者凭证与账户偏好。"}
                  {activeTab === "general" && "配置默认推理规划模式、桌面推送通知与全局偏好重置。"}
                  {activeTab === "appearance" && "选择界面显示主题（浅色模式、深色模式或跟随系统）。"}
                  {activeTab === "models" && "查看 API 推理模型额度、多模态支持与首选模型。"}
                  {activeTab === "browser" && "管理 Chrome DevTools 网页自动化审查与控制引擎。"}
                  {activeTab === "app" && "查看客户端版本信息、Service Worker 缓存与草稿管理。"}
                  {activeTab === "status" && "查看语言服务代理长连接状态与实时项目节点。"}
                </p>
              </div>
              <div className="settings-desktop-header-actions">
                {savedFlash && <span className="settings-saved-badge">✓ 已保存</span>}
                <button className="settings-close-btn" onClick={onBack} title="关闭设置 (Esc)">
                  <IconX size={18} />
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 1. 🧠 记忆 (Memory) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "memory" && (
            <div className="settings-section-container">
              {/* Section 1: Global Instructions */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <span className="section-header-title">全局开发者记忆与指令 (Global Instructions)</span>
                  <button type="button" onClick={fetchCapabilities} className="btn-section-refresh">
                    <IconRefresh size={11} />
                    <span>刷新</span>
                  </button>
                </div>
                <div className="customizations-list">
                  {(memoryData?.globalInstructions ?? []).map((rec) => (
                    <div key={rec.id} className="capability-card-row">
                      <div className="capability-card-left">
                        <div className="capability-card-title">
                          <IconBrain size={15} style={{ color: "var(--accent)" }} />
                          <span className="capability-name-text">{rec.name}</span>
                          <span className="skill-tag">{rec.sizeBytes > 0 ? `${(rec.sizeBytes / 1024).toFixed(1)} KB` : "未创建"}</span>
                        </div>
                        <div className="capability-card-desc">{rec.description}</div>
                        <div className="capability-card-path">{rec.path}</div>
                      </div>
                      <div className="capability-card-actions">
                        <button
                          type="button"
                          className="btn-capability-action"
                          onClick={() => {
                            setEditingMemory(rec);
                            setEditMemoryContent(rec.content);
                          }}
                        >
                          <IconEdit size={13} />
                          <span>{rec.sizeBytes > 0 ? "查看 / 编辑" : "创建此记忆"}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Workspace Rules */}
              <div className="settings-card-group">
                <div className="settings-card-group-title">当前工作区规则 (Workspace Rules)</div>
                {memoryData?.workspaceRules && memoryData.workspaceRules.length > 0 ? (
                  <div className="customizations-list">
                    {memoryData.workspaceRules.map((rec) => (
                      <div key={rec.id} className="capability-card-row">
                        <div className="capability-card-left">
                          <div className="capability-card-title">
                            <IconFileText size={15} />
                            <span className="capability-name-text">{rec.name}</span>
                            <span className="skill-tag">工作区专属</span>
                          </div>
                          <div className="capability-card-desc">{rec.description}</div>
                          <div className="capability-card-path">{rec.path}</div>
                        </div>
                        <div className="capability-card-actions">
                          <button
                            type="button"
                            className="btn-capability-action"
                            onClick={() => {
                              setEditingMemory(rec);
                              setEditMemoryContent(rec.content);
                            }}
                          >
                            <IconEdit size={13} />
                            <span>编辑规则</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-notice-box">
                    <span>当前工作区尚未配置专属 `GEMINI.md` 或 `.agents/rules/` 规则文件。</span>
                  </div>
                )}
              </div>

              {/* Section 3: Learned & Implicit Memories */}
              <div className="settings-card-group">
                <div className="settings-card-group-title">长效上下文记忆与偏好 (Learned Memories)</div>
                <div className="customizations-list">
                  {(memoryData?.learnedMemories ?? []).map((rec) => (
                    <div key={rec.id} className="capability-card-row">
                      <div className="capability-card-left">
                        <div className="capability-card-title">
                          <IconSparkles size={14} style={{ color: "#a855f7" }} />
                          <span className="capability-name-text">{rec.name}</span>
                          <span className="mcp-tag">{rec.type === "learned_pattern" ? "使用偏好" : "会话向量快照"}</span>
                        </div>
                        <div className="capability-card-desc">{rec.description}</div>
                        <div className="capability-card-path">{rec.path}</div>
                      </div>
                      {rec.isEditable && (
                        <div className="capability-card-actions">
                          <button
                            type="button"
                            className="btn-capability-action"
                            onClick={() => {
                              setEditingMemory(rec);
                              setEditMemoryContent(rec.content);
                            }}
                          >
                            <IconEdit size={13} />
                            <span>查看配置</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 2. 🧩 插件 (Plugins) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "plugins" && (
            <div className="settings-section-container">
              {/* Section 1: Google Official Plugins (Build With Google Plugins) */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <div className="section-header-title-wrap">
                    <span className="section-header-title">Google 官方扩展插件 (Build With Google Plugins)</span>
                  </div>
                  <button type="button" onClick={fetchCapabilities} className="btn-section-refresh">
                    <IconRefresh size={11} />
                    <span>刷新</span>
                  </button>
                </div>
                <div className="customizations-list">
                  {(pluginsList.filter((p) => p.category === "google_official") ?? []).map((p) => {
                    const authorStr = typeof p.author === "string" ? p.author : (p.author as any)?.name ? String((p.author as any).name) : "";
                    const bundled = p.bundled || { skillsCount: 0, hooksCount: 0, mcpCount: 0, agentsCount: 0, rulesCount: 0 };
                    const displayName = p.displayName || p.name || p.id;
                    const pluginDesc = typeof p.description === "string" ? p.description : "";

                    return (
                      <div key={p.id} className="capability-card-row" style={{ opacity: p.isInstalled ? (p.enabled ? 1 : 0.65) : 0.75 }}>
                        <div className="capability-card-left">
                          <div className="capability-card-title">
                            <IconPuzzle size={15} style={{ color: p.isInstalled && p.enabled ? "var(--accent)" : "inherit" }} />
                            <span className="capability-name-text">{displayName}</span>
                            <span className="skill-tag">Google 官方</span>
                            {authorStr && <span className="plugin-author-badge">by {authorStr}</span>}
                          </div>
                          {pluginDesc && <div className="capability-card-desc">{pluginDesc}</div>}
                          {p.isInstalled && (
                            <div className="plugin-bundled-tags">
                              {bundled.skillsCount > 0 && <span className="bundled-tag">🪄 {bundled.skillsCount} 技能</span>}
                              {bundled.hooksCount > 0 && <span className="bundled-tag">⚓ {bundled.hooksCount} 钩子</span>}
                              {bundled.mcpCount > 0 && <span className="bundled-tag">🔌 {bundled.mcpCount} MCP服务</span>}
                              {bundled.agentsCount > 0 && <span className="bundled-tag">🤖 {bundled.agentsCount} 智能体</span>}
                              {bundled.rulesCount > 0 && <span className="bundled-tag">📜 {bundled.rulesCount} 规则</span>}
                            </div>
                          )}
                        </div>
                        <div className="capability-card-actions">
                          {p.isInstalled ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                type="button"
                                className="btn-capability-delete"
                                disabled={installingPluginId === p.id}
                                onClick={() => handleUninstallPlugin(p.id, displayName)}
                                title="从本地删除此插件"
                              >
                                {installingPluginId === p.id ? "处理中..." : "Delete"}
                              </button>
                              <label className="settings-switch">
                                <input
                                  type="checkbox"
                                  checked={!!p.enabled}
                                  onChange={() => togglePlugin(p.id, !!p.enabled)}
                                  aria-label={`开关插件 ${displayName}`}
                                />
                                <span className="settings-slider" />
                              </label>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-capability-action btn-download-plugin"
                              disabled={installingPluginId === p.id}
                              onClick={() => handleInstallPlugin(p.id)}
                            >
                              <span>{installingPluginId === p.id ? "下载安装中..." : "Download"}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Community & Developer Plugins */}
              {pluginsList.some((p) => p.category === "community" || !p.category) && (
                <div className="settings-card-group">
                  <div className="settings-card-group-title">社区与第三方扩展套件</div>
                  <div className="customizations-list">
                    {pluginsList.filter((p) => p.category !== "google_official").map((p) => {
                      const authorStr = typeof p.author === "string" ? p.author : (p.author as any)?.name ? String((p.author as any).name) : "";
                      const bundled = p.bundled || { skillsCount: 0, hooksCount: 0, mcpCount: 0, agentsCount: 0, rulesCount: 0 };
                      const displayName = p.displayName || p.name || p.id;
                      const pluginDesc = typeof p.description === "string" ? p.description : "";
                      const pluginVersion = typeof p.version === "string" ? p.version : "1.0.0";

                      return (
                        <div key={p.id} className="capability-card-row" style={{ opacity: p.enabled ? 1 : 0.65 }}>
                          <div className="capability-card-left">
                            <div className="capability-card-title">
                              <IconPuzzle size={15} style={{ color: p.enabled ? "var(--accent)" : "inherit" }} />
                              <span className="capability-name-text">{displayName}</span>
                              <span className="plugin-version-badge">v{pluginVersion}</span>
                              {authorStr && <span className="plugin-author-badge">by {authorStr}</span>}
                            </div>
                            {pluginDesc && <div className="capability-card-desc">{pluginDesc}</div>}
                            <div className="plugin-bundled-tags">
                              {bundled.skillsCount > 0 && <span className="bundled-tag">🪄 {bundled.skillsCount} 技能</span>}
                              {bundled.hooksCount > 0 && <span className="bundled-tag">⚓ {bundled.hooksCount} 钩子</span>}
                              {bundled.mcpCount > 0 && <span className="bundled-tag">🔌 {bundled.mcpCount} MCP服务</span>}
                              {bundled.agentsCount > 0 && <span className="bundled-tag">🤖 {bundled.agentsCount} 智能体</span>}
                              {bundled.rulesCount > 0 && <span className="bundled-tag">📜 {bundled.rulesCount} 规则</span>}
                            </div>
                          </div>
                          <div className="capability-card-actions">
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                type="button"
                                className="btn-capability-delete"
                                disabled={installingPluginId === p.id}
                                onClick={() => handleUninstallPlugin(p.id, displayName)}
                                title="从本地删除此插件"
                              >
                                {installingPluginId === p.id ? "处理中..." : "Delete"}
                              </button>
                              <label className="settings-switch">
                                <input
                                  type="checkbox"
                                  checked={!!p.enabled}
                                  onChange={() => togglePlugin(p.id, !!p.enabled)}
                                  aria-label={`开关插件 ${displayName}`}
                                />
                                <span className="settings-slider" />
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 3. 🪄 技能 (Skills) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "skills" && (
            <div className="settings-section-container">
              {/* Search and Filters */}
              <div className="skills-search-bar">
                <div className="skills-search-input-wrap">
                  <IconSearch size={14} className="skills-search-icon" />
                  <input
                    type="text"
                    placeholder="搜索技能名称或功能描述..."
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    className="skills-search-input"
                  />
                  {skillSearch && (
                    <button className="skills-search-clear" onClick={() => setSkillSearch("")}>×</button>
                  )}
                </div>
                <div className="skills-filter-pills">
                  {(["all", "builtin", "global", "plugin"] as const).map((f) => (
                    <button
                      key={f}
                      className={`filter-pill ${skillFilter === f ? "active" : ""}`}
                      onClick={() => setSkillFilter(f)}
                    >
                      {f === "all" && "全部技能"}
                      {f === "builtin" && "内置"}
                      {f === "global" && "全局扩展"}
                      {f === "plugin" && "插件捆绑"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skills List */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <span className="section-header-title">技能列表 ({filteredSkills.length})</span>
                  <button type="button" onClick={fetchCapabilities} className="btn-section-refresh">
                    <IconRefresh size={11} />
                    <span>刷新</span>
                  </button>
                </div>
                <div className="customizations-list">
                  {filteredSkills.map((s) => {
                    const isEnabled = !disabledSkills.has(s.name);
                    const sourceLabel =
                      s.source === "builtin"
                        ? "内置"
                        : s.source === "global"
                          ? "全局"
                          : s.pluginName
                            ? `插件: ${s.pluginName}`
                            : "扩展";

                    return (
                      <div key={s.name} className="capability-card-row" style={{ opacity: isEnabled ? 1 : 0.6 }}>
                        <div className="capability-card-left">
                          <div className="capability-card-title">
                            <IconWand size={15} style={{ color: "var(--accent)" }} />
                            <span className="capability-name-text">{s.title || s.name}</span>
                            <span className="skill-tag">{sourceLabel}</span>
                            {s.hasScripts && <span className="mini-badge">脚本</span>}
                            {s.hasReferences && <span className="mini-badge">手册</span>}
                          </div>
                          <div className="capability-card-desc">
                            <span className="skill-id-code">{s.name}</span>
                            {s.description}
                          </div>
                        </div>
                        <div className="capability-card-actions">
                          <button
                            type="button"
                            className="btn-capability-action"
                            onClick={() => inspectSkill(s)}
                            title="查看完整 SKILL.md 文档"
                          >
                            <span>查看手册</span>
                          </button>
                          <label className="settings-switch">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleSkill(s.name)}
                              aria-label={`开关 ${s.name}`}
                            />
                            <span className="settings-slider" />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 4. 🤖 子智能体 (Subagents) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "subagents" && (
            <div className="settings-section-container">
              {/* Header with Title, View Layout Mode Switch, and Action Buttons */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <span className="section-header-title">专业子智能体分工 ({filteredSubagents.length})</span>
                    {/* View Layout Mode Toggle */}
                    <div className="theme-segmented-control" style={{ padding: "2px" }}>
                      <button
                        type="button"
                        className={`theme-segment-btn ${subagentViewMode === "compact" ? "active" : ""}`}
                        onClick={() => setSubagentViewMode("compact")}
                        style={{ padding: "3px 9px", fontSize: "11px" }}
                      >
                        紧凑排布
                      </button>
                      <button
                        type="button"
                        className={`theme-segment-btn ${subagentViewMode === "cards" ? "active" : ""}`}
                        onClick={() => setSubagentViewMode("cards")}
                        style={{ padding: "3px 9px", fontSize: "11px" }}
                      >
                        详细卡片
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      className="btn-create-subagent"
                      onClick={openNewAgentModal}
                      title="新建全局自定义子智能体"
                    >
                      <IconPlus size={13} />
                      <span>新建智能体</span>
                    </button>
                    <button type="button" onClick={fetchCapabilities} className="btn-section-refresh">
                      <IconRefresh size={11} />
                      <span>刷新</span>
                    </button>
                  </div>
                </div>

                {/* Search & Category Filter Pills */}
                <div className="skills-search-bar" style={{ marginBottom: "12px" }}>
                  <div className="skills-search-input-wrap">
                    <IconSearch size={14} className="skills-search-icon" />
                    <input
                      type="text"
                      placeholder="搜索智能体代号、职责或描述..."
                      value={subagentSearch}
                      onChange={(e) => setSubagentSearch(e.target.value)}
                      className="skills-search-input"
                    />
                    {subagentSearch && (
                      <button className="skills-search-clear" onClick={() => setSubagentSearch("")}>×</button>
                    )}
                  </div>
                  <div className="skills-filter-pills">
                    {(["all", "builtin", "plugin", "custom"] as const).map((f) => (
                      <button
                        key={f}
                        className={`filter-pill ${subagentFilter === f ? "active" : ""}`}
                        onClick={() => setSubagentFilter(f)}
                      >
                        {f === "all" && `全部 (${subagentsList.length})`}
                        {f === "builtin" && "内置"}
                        {f === "plugin" && "插件"}
                        {f === "custom" && `自定义 (${subagentsList.filter((a) => a.source === "custom").length})`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subagents List */}
                <div className="customizations-list">
                  {filteredSubagents.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-tertiary)", fontSize: "13px" }}>
                      未找到符合条件的智能体
                    </div>
                  ) : subagentViewMode === "compact" ? (
                    /* ── 1. 紧凑排布 (高度集中、精简明了) ── */
                    filteredSubagents.map((agent) => {
                      const isExpanded = expandedSubagent === agent.id;
                      const isOpened = openedAgentPath === agent.path;
                      const isCopied = copiedAgentPath === agent.path;

                      return (
                        <div key={agent.id} className="subagent-compact-card">
                          {/* Row 1: Title + Role + Source Badge + Actions */}
                          <div className="subagent-compact-header">
                            <div className="subagent-compact-title-group">
                              <IconBot size={15} style={{ color: agent.source === "custom" ? "#c084fc" : "#10b981" }} />
                              <span className="capability-name-text" style={{ fontSize: "13.5px" }}>{agent.name}</span>
                              <span className="subagent-role-badge" style={{ fontSize: "10.5px", padding: "1px 6px" }}>{agent.role}</span>
                              {agent.source === "builtin" && <span className="skill-tag" style={{ fontSize: "10px" }}>内置</span>}
                              {agent.source === "custom" && (
                                <span className="mini-badge" style={{ background: "rgba(168, 85, 247, 0.15)", color: "#a855f7" }}>
                                  自定义
                                </span>
                              )}
                              {agent.pluginName && (
                                <span className="plugin-version-badge" style={{ fontSize: "10px" }}>{agent.pluginName}</span>
                              )}
                            </div>

                            <div className="subagent-compact-actions">
                              {agent.path && (
                                <button
                                  type="button"
                                  className="btn-capability-action"
                                  title="在系统资源管理器中定位并打开该智能体文件"
                                  onClick={async () => {
                                    if (!agent.path) return;
                                    try {
                                      await api.agentCapabilities.openPath(agent.path);
                                      setOpenedAgentPath(agent.path);
                                      setTimeout(() => setOpenedAgentPath(null), 2000);
                                    } catch {}
                                  }}
                                >
                                  <IconFolder size={11} />
                                  <span>{isOpened ? "✓ 已打开" : "位置"}</span>
                                </button>
                              )}
                              {agent.source === "custom" && (
                                <>
                                  <button
                                    type="button"
                                    className="btn-capability-action"
                                    title="编辑该自定义智能体"
                                    onClick={() => {
                                      setEditingAgent(agent);
                                      setAgentFormName(agent.name);
                                      setAgentFormRole(agent.role);
                                      setAgentFormDesc(agent.description);
                                      setAgentFormTools(agent.tools);
                                      setAgentFormPrompt(agent.systemPrompt);
                                      setShowAgentEditor(true);
                                    }}
                                  >
                                    <IconEdit size={11} />
                                    <span>编辑</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-capability-delete"
                                    title="删除该自定义智能体"
                                    onClick={() => handleDeleteAgent(agent)}
                                  >
                                    <IconTrash size={11} />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn-capability-action"
                                onClick={() => setExpandedSubagent(isExpanded ? null : agent.id)}
                              >
                                <span>{isExpanded ? "收起" : "提示词"}</span>
                              </button>
                            </div>
                          </div>

                          {/* Row 2: One-line concise description */}
                          <div className="subagent-compact-desc">{agent.description}</div>

                          {/* Row 3: Concentrated Footer (Tools + Path) */}
                          <div className="subagent-compact-footer">
                            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                              {agent.tools.slice(0, 4).map((t) => (
                                <span key={t} className="tool-chip-mini">{t}</span>
                              ))}
                              {agent.tools.length > 4 && (
                                <span className="tool-chip-mini" style={{ opacity: 0.7 }}>
                                  +{agent.tools.length - 4}
                                </span>
                              )}
                            </div>

                            {agent.path ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ fontSize: "10.5px", color: "var(--text-tertiary)" }}>本地文件:</span>
                                <button
                                  type="button"
                                  className="btn-copy-mini"
                                  title={agent.path}
                                  onClick={() => {
                                    if (!agent.path) return;
                                    navigator.clipboard.writeText(agent.path);
                                    setCopiedAgentPath(agent.path);
                                    setTimeout(() => setCopiedAgentPath(null), 2000);
                                  }}
                                >
                                  {isCopied ? <IconCheck size={10} style={{ color: "#10b981" }} /> : <IconCopy size={10} />}
                                </button>
                              </div>
                            ) : (
                              <span className="subagent-builtin-hint">内存动态初始化</span>
                            )}
                          </div>

                          {/* Expandable Prompt Drawer */}
                          {isExpanded && (
                            <div className="subagent-prompt-box">
                              <div className="subagent-prompt-title">系统提示词模版 (System Prompt):</div>
                              <pre className="subagent-prompt-content">{agent.systemPrompt}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    /* ── 2. 详细卡片排布 ── */
                    filteredSubagents.map((agent) => {
                      const isExpanded = expandedSubagent === agent.id;
                      const isOpened = openedAgentPath === agent.path;
                      const isCopied = copiedAgentPath === agent.path;

                      return (
                        <div key={agent.id} className="capability-card-row agent-card-col">
                          <div className="capability-card-header-row">
                            <div className="capability-card-title">
                              <IconBot size={16} style={{ color: agent.source === "custom" ? "#c084fc" : "#10b981" }} />
                              <span className="capability-name-text">{agent.name}</span>
                              <span className="subagent-role-badge">{agent.role}</span>
                              {agent.source === "builtin" && <span className="skill-tag">内置智能体</span>}
                              {agent.source === "custom" && (
                                <span className="mini-badge" style={{ background: "rgba(168, 85, 247, 0.15)", color: "#a855f7" }}>
                                  自定义智能体
                                </span>
                              )}
                              {agent.pluginName && <span className="plugin-version-badge">{agent.pluginName}</span>}
                            </div>
                            <div className="capability-card-actions" style={{ display: "flex", gap: "6px" }}>
                              {agent.path && (
                                <button
                                  type="button"
                                  className="btn-capability-action"
                                  title="在系统资源管理器中定位并打开该智能体文件"
                                  onClick={async () => {
                                    if (!agent.path) return;
                                    try {
                                      await api.agentCapabilities.openPath(agent.path);
                                      setOpenedAgentPath(agent.path);
                                      setTimeout(() => setOpenedAgentPath(null), 2000);
                                    } catch {}
                                  }}
                                >
                                  <IconFolder size={12} />
                                  <span>{isOpened ? "✓ 已在本地打开" : "打开存放位置"}</span>
                                </button>
                              )}
                              {agent.source === "custom" && (
                                <>
                                  <button
                                    type="button"
                                    className="btn-capability-action"
                                    title="编辑该自定义智能体"
                                    onClick={() => {
                                      setEditingAgent(agent);
                                      setAgentFormName(agent.name);
                                      setAgentFormRole(agent.role);
                                      setAgentFormDesc(agent.description);
                                      setAgentFormTools(agent.tools);
                                      setAgentFormPrompt(agent.systemPrompt);
                                      setShowAgentEditor(true);
                                    }}
                                  >
                                    <IconEdit size={12} />
                                    <span>编辑</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-capability-delete"
                                    title="删除该自定义智能体"
                                    onClick={() => handleDeleteAgent(agent)}
                                  >
                                    <IconTrash size={12} />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn-capability-action"
                                onClick={() => setExpandedSubagent(isExpanded ? null : agent.id)}
                              >
                                <span>{isExpanded ? "收起提示词" : "查看提示词"}</span>
                              </button>
                            </div>
                          </div>

                          <div className="capability-card-desc">{agent.description}</div>

                          {/* Local File Path Row */}
                          {agent.path ? (
                            <div className="subagent-path-row">
                              <span className="subagent-path-label">本地存放位置：</span>
                              <code className="subagent-path-text">{agent.path}</code>
                              <button
                                type="button"
                                className="btn-copy-mini"
                                title="复制本地绝对路径"
                                onClick={() => {
                                  if (!agent.path) return;
                                  navigator.clipboard.writeText(agent.path);
                                  setCopiedAgentPath(agent.path);
                                  setTimeout(() => setCopiedAgentPath(null), 2000);
                                }}
                              >
                                {isCopied ? <IconCheck size={11} style={{ color: "#10b981" }} /> : <IconCopy size={11} />}
                              </button>
                            </div>
                          ) : (
                            <div className="subagent-path-row">
                              <span className="subagent-path-label">存放机制：</span>
                              <span className="subagent-builtin-hint">Antigravity 引擎原生内置（进程内存中动态初始化）</span>
                            </div>
                          )}

                          {/* Allowed Tools Chips */}
                          <div className="subagent-tools-wrap">
                            <span className="tools-label">授权工具集：</span>
                            {agent.tools.map((t) => (
                              <span key={t} className="tool-chip">{t}</span>
                            ))}
                          </div>

                          {/* Expandable System Prompt */}
                          {isExpanded && (
                            <div className="subagent-prompt-box">
                              <div className="subagent-prompt-title">系统提示词模版 (System Prompt):</div>
                              <pre className="subagent-prompt-content">{agent.systemPrompt}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 5. 🔌 MCP 服务器 (MCP Servers) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "mcp_servers" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <span className="section-header-title">Model Context Protocol 接入服务 ({mcpServersList.length})</span>
                  <button type="button" onClick={fetchCapabilities} className="btn-section-refresh">
                    <IconRefresh size={11} />
                    <span>刷新 MCP</span>
                  </button>
                </div>
                <div className="customizations-list">
                  {mcpServersList.map((m) => {
                    const isConnected = !m.disabled;
                    const isToolsExpanded = expandedMcpTools === m.name;
                    const isOpened = openedMcpPath === m.path;
                    const isCopied = copiedMcpPath === m.path;

                    return (
                      <div key={m.name} className="capability-card-row agent-card-col" style={{ opacity: isConnected ? 1 : 0.6 }}>
                        <div className="capability-card-header-row">
                          <div className="capability-card-title">
                            <IconPlug size={15} style={{ color: "var(--accent)" }} />
                            <span className="capability-name-text">{m.name}</span>
                            <span className="mcp-tag">{m.transport === "stdio" ? "Stdio (本地进程)" : "SSE (远程服务)"}</span>
                            <span className={`customization-status-badge mcp ${isConnected ? "" : "disabled"}`}>
                              {isConnected ? "● 已连接" : "○ 已禁用"}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {m.path && (
                              <button
                                type="button"
                                className="btn-capability-action"
                                title="在系统资源管理器中定位并打开该 MCP 服务的本地脚本或目录"
                                onClick={async () => {
                                  if (!m.path) return;
                                  try {
                                    await api.agentCapabilities.openPath(m.path);
                                    setOpenedMcpPath(m.path);
                                    setTimeout(() => setOpenedMcpPath(null), 2000);
                                  } catch {}
                                }}
                              >
                                <IconFolder size={12} />
                                <span>{isOpened ? "✓ 已在本地打开" : "打开存放位置"}</span>
                              </button>
                            )}
                            <label className="settings-switch">
                              <input
                                type="checkbox"
                                checked={isConnected}
                                onChange={() => toggleMcpServer(m.name, m.disabled)}
                                aria-label={`开关 ${m.name}`}
                              />
                              <span className="settings-slider" />
                            </label>
                          </div>
                        </div>

                        <div className="capability-card-desc">{m.description}</div>

                        {/* Transport command info */}
                        <div className="mcp-cmd-info">
                          {m.command && (
                            <div className="mcp-cmd-line">
                              <span className="mcp-label">启动指令:</span>
                              <code>{m.command} {m.args?.join(" ")}</code>
                            </div>
                          )}
                          {m.serverUrl && (
                            <div className="mcp-cmd-line">
                              <span className="mcp-label">服务 URL:</span>
                              <code>{m.serverUrl}</code>
                            </div>
                          )}
                          {m.envKeys && m.envKeys.length > 0 && (
                            <div className="mcp-cmd-line">
                              <span className="mcp-label">环境变量:</span>
                              <span>{m.envKeys.map((k) => `${k}=••••`).join(", ")}</span>
                            </div>
                          )}
                          {m.path && (
                            <div className="subagent-path-row" style={{ marginTop: "6px" }}>
                              <span className="subagent-path-label">服务位置:</span>
                              <code className="subagent-path-text">{m.path}</code>
                              <button
                                type="button"
                                className="btn-copy-mini"
                                title="复制服务本地绝对路径"
                                onClick={() => {
                                  if (!m.path) return;
                                  navigator.clipboard.writeText(m.path);
                                  setCopiedMcpPath(m.path);
                                  setTimeout(() => setCopiedMcpPath(null), 2000);
                                }}
                              >
                                {isCopied ? <IconCheck size={11} style={{ color: "#10b981" }} /> : <IconCopy size={11} />}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Tools Drawer Toggle */}
                        {m.toolsCount > 0 && (
                          <div className="mcp-tools-drawer-toggle">
                            <button
                              type="button"
                              className="btn-link-action"
                              onClick={() => setExpandedMcpTools(isToolsExpanded ? null : m.name)}
                            >
                              {isToolsExpanded ? "收起工具列表 ▲" : `查看已公开的 ${m.toolsCount} 个工具 ▼`}
                            </button>
                          </div>
                        )}

                        {isToolsExpanded && (m.tools ?? []).length > 0 && (
                          <div className="mcp-tools-list-grid">
                            {(m.tools ?? []).map((t) => (
                              <div key={t.name} className="mcp-tool-item">
                                <div className="mcp-tool-name">{t.name}</div>
                                <div className="mcp-tool-desc">{t.description}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 6. >_ 命令 (Commands) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "commands" && commandSubView === "form" && (
            <div className="command-create-view-container">
              <div className="command-create-top-bar">
                <h1 className="command-create-main-title">命令</h1>
                <div className="settings-desktop-header-actions">
                  {savedFlash && <span className="settings-saved-badge">✓ 已保存</span>}
                  <button className="settings-close-btn" onClick={onBack} title="关闭设置 (Esc)">
                    <IconX size={18} />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="command-back-link"
                onClick={() => {
                  setCommandSubView("list");
                  setEditingCommand(null);
                }}
              >
                <span>← 返回</span>
              </button>

              <div className="command-create-section-title">
                {editingCommand ? "编辑命令" : "新建命令"}
              </div>
              <div className="command-create-section-desc">
                填写命令名称和提示词，保存后返回列表。
              </div>

              <div className="command-create-card">
                {/* Row 1: Name and Scope */}
                <div className="command-create-top-row">
                  <div className="command-create-name-field">
                    <label className="command-create-label">名称</label>
                    <input
                      type="text"
                      className="command-create-input"
                      placeholder="my-command"
                      value={cmdFormName}
                      onChange={(e) => setCmdFormName(e.target.value)}
                    />
                  </div>
                  <div className="command-create-scope-field">
                    <span className="command-create-scope-label">作用域</span>
                    <CustomSelect<"user" | "workspace">
                      value={cmdFormScope}
                      options={[
                        { value: "user", label: "用户" },
                        { value: "workspace", label: "项目" },
                      ]}
                      onChange={(val) => setCmdFormScope(val)}
                      style={{ minWidth: "120px" }}
                    />
                  </div>
                </div>

                {/* Row 2: Description */}
                <div>
                  <label className="command-create-label">描述（可选）</label>
                  <input
                    type="text"
                    className="command-create-input"
                    placeholder="在命令选择器中显示的简短描述"
                    value={cmdFormDesc}
                    onChange={(e) => setCmdFormDesc(e.target.value)}
                  />
                </div>

                {/* Row 3: Argument Hint */}
                <div>
                  <label className="command-create-label">参数提示（可选）</label>
                  <input
                    type="text"
                    className="command-create-input"
                    placeholder="例如 <file-path>"
                    value={cmdFormArgHint}
                    onChange={(e) => setCmdFormArgHint(e.target.value)}
                  />
                </div>

                {/* Row 4: Prompt */}
                <div>
                  <label className="command-create-label">提示词</label>
                  <textarea
                    className="command-create-textarea"
                    placeholder="填写调用该命令时发送的提示词..."
                    value={cmdFormPrompt}
                    onChange={(e) => setCmdFormPrompt(e.target.value)}
                    rows={8}
                  />
                </div>

                {/* Row 5: Action Buttons */}
                <div className="command-create-actions">
                  <button
                    type="button"
                    className="command-create-btn-save"
                    onClick={handleSaveCommand}
                    disabled={cmdFormSaving || !cmdFormName.trim() || !cmdFormPrompt.trim()}
                  >
                    {cmdFormSaving ? "保存中..." : "保存"}
                  </button>
                  <button
                    type="button"
                    className="command-create-btn-cancel"
                    onClick={() => {
                      setCommandSubView("list");
                      setEditingCommand(null);
                    }}
                    disabled={cmdFormSaving}
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "commands" && commandSubView === "list" && (
            <div className="settings-section-container">
              {/* Header Area */}
              <div className="command-center-header">
                <div className="command-center-title-area">
                  <div className="command-center-main-title">命令</div>
                  <div className="command-center-subtitle">
                    管理 Agent 的 .md 命令文件。命令可通过 /command-name 在聊天中调用。
                  </div>
                </div>
                <div className="command-center-header-actions">
                  <button
                    type="button"
                    className="command-icon-btn"
                    onClick={() => {
                      setCommandSubView("form");
                      setEditingCommand(null);
                    }}
                    title="新建命令"
                  >
                    <IconPlus size={16} />
                  </button>
                  <button
                    type="button"
                    className="command-icon-btn"
                    onClick={openNewCommandModal}
                    title="快速指令模版"
                  >
                    <IconDownload size={15} />
                  </button>
                  <button
                    type="button"
                    className="command-icon-btn"
                    onClick={async () => {
                      const userCmd = commandsList.find((c) => c.source === "custom" && c.path);
                      const target = userCmd ? (userCmd.dirPath || userCmd.path) : "C:\\Users\\20269\\.agents\\commands";
                      if (target) {
                        try {
                          await api.agentCapabilities.openPath(target);
                        } catch {}
                      }
                    }}
                    title="打开命令存放位置文件夹"
                  >
                    <IconFolder size={15} />
                  </button>
                  <button
                    type="button"
                    className="command-icon-btn"
                    onClick={fetchCapabilities}
                    title="刷新命令列表"
                  >
                    <IconRefresh size={14} />
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="command-search-input-box">
                <input
                  type="text"
                  placeholder="搜索命令..."
                  value={commandSearch}
                  onChange={(e) => setCommandSearch(e.target.value)}
                />
              </div>

              {/* Render Groups: 用户命令, 官方内置命令, 插件命令 */}
              {[
                {
                  key: "user",
                  title: "用户命令",
                  items: filteredCommands.filter((c) => c.source === "custom" || c.source === "workspace"),
                },
                {
                  key: "builtin",
                  title: "官方内置命令",
                  items: filteredCommands.filter(
                    (c) => (c.source ?? (c.category === "slash_builtin" ? "builtin" : "plugin")) === "builtin"
                  ),
                },
                {
                  key: "plugin",
                  title: "插件命令",
                  items: filteredCommands.filter(
                    (c) => (c.source ?? (c.category === "slash_builtin" ? "builtin" : "plugin")) === "plugin"
                  ),
                },
              ].map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <div key={group.key} className="command-section-group">
                    <div className="command-section-title-row">
                      <span>{group.title}</span>
                      <span className="command-section-count">{group.items.length} 项</span>
                    </div>

                    <div className="command-card-container">
                      {group.items.map((c) => {
                        const isExpanded = expandedCommand === c.cmd;
                        return (
                          <div key={c.cmd} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <div className="command-item-row">
                              <div className="command-item-left">
                                <div className="command-avatar-badge">&gt;_</div>
                                <div className="command-info-col">
                                  <div className="command-header-line">
                                    <span className="command-cmd-text slash-card-cmd">{c.cmd}</span>
                                    {c.argumentHint && (
                                      <span className="command-arg-hint">"{c.argumentHint}"</span>
                                    )}
                                    <span className="command-source-pill">
                                      {c.source === "custom" ? "用户" : c.source === "workspace" ? "项目" : c.source === "builtin" ? "官方" : c.pluginName || "插件"}
                                    </span>
                                  </div>
                                  <div className="command-desc-line">"{c.description}"</div>
                                  <div className="command-path-line">{c.dirPath || c.path || "系统内置指令"}</div>
                                </div>
                              </div>

                              <div className="command-item-right">
                                {c.path && (
                                  <button
                                    type="button"
                                    className="command-icon-btn"
                                    title="在系统资源管理器中打开存放位置"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (!c.path) return;
                                      try {
                                        await api.agentCapabilities.openPath(c.path);
                                      } catch {}
                                    }}
                                  >
                                    <IconFolder size={14} />
                                  </button>
                                )}
                                {(c.source === "custom" || c.source === "workspace") && (
                                  <>
                                    <button
                                      type="button"
                                      className="command-icon-btn"
                                      title="编辑自定义命令"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditCommand(c);
                                      }}
                                    >
                                      <IconEdit size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      className="command-icon-btn"
                                      title="删除自定义命令"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteCommand(c);
                                      }}
                                    >
                                      <IconTrash size={14} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="command-icon-btn"
                                  title={isExpanded ? "收起提示词与说明" : "查看提示词与说明"}
                                  onClick={() => setExpandedCommand(isExpanded ? null : c.cmd)}
                                >
                                  <IconMessageSquare size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="command-icon-btn"
                                  title={copiedCmd === c.cmd ? "已复制 ✓" : "复制指令"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyCommand(c.cmd);
                                  }}
                                >
                                  {copiedCmd === c.cmd ? (
                                    <IconCheck size={14} style={{ color: "#34d399" }} />
                                  ) : (
                                    <IconCopy size={14} />
                                  )}
                                </button>

                                <label className="command-switch-toggle" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={
                                      !disabledCommands.has(c.cmd) &&
                                      !disabledCommands.has(c.cmd.startsWith("/") ? c.cmd.slice(1) : `/${c.cmd}`) &&
                                      c.enabled !== false
                                    }
                                    onChange={(e) => {
                                      handleToggleCommand(c.cmd, e.target.checked);
                                    }}
                                  />
                                  <span className="command-switch-slider"></span>
                                </label>
                              </div>
                            </div>

                            {/* Expandable Details Drawer */}
                            {isExpanded && (
                              <div className="subagent-prompt-box" style={{ margin: "0 16px 14px 16px", borderRadius: "6px" }}>
                                <div className="subagent-prompt-title">指令规范与完整说明 (Command Specifications & Prompt):</div>
                                <pre className="subagent-prompt-content" style={{ whiteSpace: "pre-wrap", lineHeight: "1.55", maxHeight: "300px", overflowY: "auto", fontFamily: "var(--font-sans)", fontSize: "12.5px" }}>
                                  {c.fullPrompt || c.promptSnippet || "暂无具体规范说明"}
                                </pre>
                                {c.path && (
                                  <div className="subagent-path-row" style={{ marginTop: "8px" }}>
                                    <span className="subagent-path-label">本地文件：</span>
                                    <code className="subagent-path-text">{c.path}</code>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 7. ⚓ 钩子 (Hooks) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 7. ⚓ 钩子 (Hooks) ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "hooks" && hookSubView === "form" && (
            <div className="settings-section-container">
              <div className="hook-create-view-container">
                {/* Header line with Title & Close */}
                <div className="command-create-top-bar">
                  <div className="hook-create-main-title">钩子</div>
                  <div className="settings-desktop-header-actions">
                    {savedFlash && <span className="settings-saved-badge">✓ 已保存</span>}
                    <button className="settings-close-btn" onClick={onBack} title="关闭设置 (Esc)">
                      <IconX size={18} />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="hook-back-link"
                  onClick={() => {
                    setHookSubView("list");
                    setEditingHook(null);
                  }}
                >
                  <span>← 返回</span>
                </button>

                <div className="hook-create-section-title">
                  {editingHook ? "编辑钩子" : "新建钩子"}
                </div>
                <div className="hook-create-section-desc">
                  管理任务生命周期钩子，在特定事件发生时自动执行命令。
                </div>

                <div className="hook-create-card">
                  {/* Row 1: 作用域, 事件, 运行方式 */}
                  <div className="hook-create-grid-3">
                    <div className="hook-create-field">
                      <label className="hook-create-label">作用域</label>
                      <CustomSelect<"user" | "workspace">
                        value={hookFormScope}
                        options={[
                          { value: "user", label: "用户" },
                          { value: "workspace", label: "工作区" },
                        ]}
                        onChange={(val) => setHookFormScope(val)}
                        style={{ width: "100%", minWidth: "0" }}
                      />
                    </div>

                    <div className="hook-create-field">
                      <label className="hook-create-label">事件</label>
                      <CustomSelect<"PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop">
                        value={hookFormEvent}
                        options={[
                          { value: "PreToolUse", label: "PreToolUse" },
                          { value: "PostToolUse", label: "PostToolUse" },
                          { value: "PreInvocation", label: "PreInvocation" },
                          { value: "PostInvocation", label: "PostInvocation" },
                          { value: "Stop", label: "Stop" },
                        ]}
                        onChange={(val) => setHookFormEvent(val)}
                        style={{ width: "100%", minWidth: "0" }}
                      />
                    </div>

                    <div className="hook-create-field">
                      <label className="hook-create-label">运行方式</label>
                      <CustomSelect<string>
                        value={hookFormRunType}
                        options={[{ value: "command", label: "进程" }]}
                        onChange={(val) => setHookFormRunType(val)}
                        style={{ width: "100%", minWidth: "0" }}
                      />
                    </div>
                  </div>

                  {/* Row 2: 匹配器, 命令 */}
                  <div className="hook-create-grid-2">
                    <div className="hook-create-field">
                      <label className="hook-create-label">匹配器</label>
                      <input
                        type="text"
                        className="hook-create-input"
                        placeholder="例如 Write, Edit, Bash"
                        value={hookFormMatcher}
                        onChange={(e) => setHookFormMatcher(e.target.value)}
                      />
                      <span className="hook-create-hint">留空时匹配该事件的所有输入。</span>
                    </div>

                    <div className="hook-create-field">
                      <label className="hook-create-label">命令</label>
                      <input
                        type="text"
                        className="hook-create-input"
                        placeholder="例如 echo 'Hello from hook'"
                        value={hookFormCommand}
                        onChange={(e) => setHookFormCommand(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Row 3: 参数 */}
                  <div className="hook-create-field">
                    <label className="hook-create-label">参数</label>
                    <textarea
                      className="hook-create-textarea"
                      placeholder="每行一个 argv 参数"
                      value={hookFormArgs}
                      onChange={(e) => setHookFormArgs(e.target.value)}
                      rows={4}
                    />
                    <span className="hook-create-hint">每行一个 argv 参数。</span>
                  </div>

                  {/* Row 4: 高级折叠 */}
                  <div>
                    <button
                      type="button"
                      className="hook-advanced-toggle"
                      onClick={() => setHookFormShowAdvanced(!hookFormShowAdvanced)}
                    >
                      <span>{hookFormShowAdvanced ? "∨ 高级" : "> 高级"}</span>
                    </button>

                    {hookFormShowAdvanced && (
                      <div className="hook-advanced-panel">
                        <div className="hook-create-field">
                          <label className="hook-create-label">钩子标识名（可选）</label>
                          <input
                            type="text"
                            className="hook-create-input"
                            placeholder="例如 my-safety-hook"
                            value={hookFormName}
                            onChange={(e) => setHookFormName(e.target.value)}
                          />
                        </div>

                        <div className="hook-create-field">
                          <label className="hook-create-label">超时时间（秒）</label>
                          <input
                            type="number"
                            className="hook-create-input"
                            placeholder="30"
                            value={hookFormTimeout}
                            onChange={(e) => setHookFormTimeout(Number(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Row 5: 操作按钮 */}
                  <div className="hook-create-actions">
                    <button
                      type="button"
                      className="hook-create-btn-save"
                      onClick={handleSaveHook}
                      disabled={hookFormSaving || !hookFormCommand.trim()}
                    >
                      {hookFormSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      type="button"
                      className="hook-create-btn-cancel"
                      onClick={() => {
                        setHookSubView("list");
                        setEditingHook(null);
                      }}
                      disabled={hookFormSaving}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "hooks" && hookSubView === "list" && (
            <div className="settings-section-container">
              <div className="hook-center-view-container">
                {/* Top Title Bar */}
                <div className="hook-center-header">
                  <div className="hook-center-title-area">
                    <div className="hook-center-main-title">钩子</div>
                  </div>
                  <div className="settings-desktop-header-actions">
                    {savedFlash && <span className="settings-saved-badge">✓ 已保存</span>}
                    <button className="settings-close-btn" onClick={onBack} title="关闭设置 (Esc)">
                      <IconX size={18} />
                    </button>
                  </div>
                </div>

                {/* Subtitle & Header Actions */}
                <div className="hook-center-header">
                  <div className="hook-center-subtitle">
                    管理任务生命周期钩子，在特定事件发生时自动执行命令。
                  </div>
                  <div className="hook-center-header-actions">
                    <button
                      type="button"
                      className="hook-icon-btn"
                      onClick={openNewHookForm}
                      title="新建钩子"
                    >
                      <IconPlus size={16} />
                    </button>
                    <button
                      type="button"
                      className="hook-icon-btn"
                      onClick={fetchCapabilities}
                      title="刷新列表"
                    >
                      <IconRefresh size={16} />
                    </button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="hook-search-input-box">
                  <IconSearch size={15} className="hook-search-icon-fixed" />
                  <input
                    type="text"
                    placeholder="搜索钩子..."
                    value={hookSearchQuery}
                    onChange={(e) => setHookSearchQuery(e.target.value)}
                  />
                </div>

                {/* Scope & Notice Bar */}
                <div className="hook-filter-notice-bar">
                  <button
                    type="button"
                    className={`hook-scope-badge-btn ${hookScopeFilter === "user" ? "active" : ""}`}
                    onClick={() => setHookScopeFilter(hookScopeFilter === "user" ? "all" : "user")}
                  >
                    <IconUser size={13} />
                    <span>用户</span>
                  </button>
                  <div className="hook-notice-text">
                    <IconInfo size={14} />
                    <span>Hook 配置变更将在新会话中生效。</span>
                  </div>
                </div>

                {/* Grouped Hook Cards */}
                {filteredAndGroupedHooks.groups.length > 0 ? (
                  filteredAndGroupedHooks.groups.map((grp) => (
                    <div key={grp.event} className="hook-event-section">
                      <div className="hook-event-title-row">
                        <span>{grp.event}</span>
                      </div>
                      <div className="hook-card-container">
                        {grp.hooks.map((h) => (
                          <div key={h.id} className="hook-item-row">
                            <div className="hook-item-left">
                              <div className="hook-avatar-badge">
                                <IconAnchor size={16} />
                              </div>
                              <div className="hook-info-col">
                                <div className="hook-header-line">
                                  <span className="hook-name-text">{h.name}</span>
                                  {h.matcher && (
                                    <span className="hook-matcher-badge">匹配: {h.matcher}</span>
                                  )}
                                </div>
                                <div className="hook-command-line">
                                  {h.command}
                                  {h.args && h.args.length > 0 ? ` ${h.args.join(" ")}` : ""}
                                </div>
                                <div className="hook-meta-line">
                                  <span>作用域: {h.source === "workspace" ? "工作区" : "用户"}</span>
                                  {h.timeout && <span>· 超时: {h.timeout}s</span>}
                                  <span>· 运行方式: 进程</span>
                                </div>
                              </div>
                            </div>

                            <div className="hook-item-right">
                              <label
                                className="command-switch-toggle"
                                title={h.enabled ? "已启用" : "已禁用"}
                              >
                                <input
                                  type="checkbox"
                                  checked={h.enabled}
                                  onChange={() => handleToggleHook(h)}
                                />
                                <span className="command-switch-slider" />
                              </label>
                              <button
                                type="button"
                                className="command-icon-btn"
                                onClick={() => openEditHookForm(h)}
                                title="编辑钩子"
                              >
                                <IconEdit size={14} />
                              </button>
                              <button
                                type="button"
                                className="command-icon-btn danger"
                                onClick={() => handleDeleteHook(h)}
                                title="删除钩子"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    className="hook-card-container"
                    style={{ padding: "36px 16px", textAlign: "center" }}
                  >
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        marginBottom: 8,
                        fontSize: "14px",
                        fontWeight: 600,
                      }}
                    >
                      {hookSearchQuery ? "未找到匹配的生命周期钩子" : "暂无已配置的生命周期钩子"}
                    </div>
                    <div
                      style={{
                        color: "var(--text-tertiary)",
                        fontSize: "12.5px",
                        marginBottom: 16,
                      }}
                    >
                      点击右上角「+」或下方按钮创建你的第一个 PreToolUse、Stop 等守卫钩子
                    </div>
                    <button
                      type="button"
                      className="hook-create-btn-save"
                      onClick={openNewHookForm}
                      style={{ margin: "0 auto", display: "inline-block" }}
                    >
                      新建钩子
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 数据与统计: 使用统计 ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "usage_stats" && <UsageStatisticsView />}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 8. Account ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "account" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">开发者账户</div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">开发者 Google 账户</div>
                      <div className="settings-official-desc">{userEmail || "本地已授权运行环境"}</div>
                    </div>
                    <span className="settings-status-online">● 已授权</span>
                  </div>
                </div>
              </div>

              {/* Proxy Server URL */}
              <div className="settings-card-group">
                <div className="settings-card-group-title">代理服务器连接 (Proxy Server)</div>
                <div className="settings-official-card">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", width: "100%", boxSizing: "border-box" }}>
                    <div className="settings-official-info">
                      <div className="settings-official-label">局域网 / 远程 Proxy 服务地址</div>
                      <div className="settings-official-desc">
                        在手机 APP 上运行时，填入电脑端的 Proxy 地址（如 <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "1px 4px", background: "var(--bg-tertiary)", borderRadius: 3 }}>http://192.168.1.100:3000</code>）。留空则使用当前同源地址。
                      </div>
                    </div>

                    <div className="proxy-input-row" style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                      <input
                        type="text"
                        id="proxy-server-url-input"
                        placeholder="http://192.168.x.x:3000"
                        value={customServerUrl}
                        onChange={(e) => {
                          setCustomServerUrl(e.target.value);
                          setProxyStatus("idle");
                        }}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 38,
                          padding: "0 12px",
                          fontSize: 13,
                          fontFamily: "var(--font-mono)",
                          background: "var(--bg-tertiary)",
                          border: `1px solid ${
                            proxyStatus === "error" ? "rgba(239,68,68,0.6)"
                            : proxyStatus === "ok" ? "rgba(16,163,127,0.6)"
                            : "var(--border-default)"
                          }`,
                          borderRadius: 8,
                          color: "var(--text-primary)",
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        className="btn-google-upgrade proxy-save-btn"
                        disabled={proxyStatus === "saving"}
                        style={{ height: 38, padding: "0 16px", fontSize: 13, flexShrink: 0, whiteSpace: "nowrap" }}
                        onClick={async () => {
                          setProxyStatus("saving");
                          try {
                            setCustomApiBase(customServerUrl);
                            await Promise.all([fetchModels(1), fetchUserStatus()]);
                            setProxyStatus("ok");
                            setTimeout(() => setProxyStatus("idle"), 2500);
                          } catch {
                            setProxyStatus("error");
                            setTimeout(() => setProxyStatus("idle"), 3000);
                          }
                        }}
                      >
                        {proxyStatus === "saving" ? "连接中…" : proxyStatus === "ok" ? "✓ 已保存" : "保存地址"}
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      当前使用地址：<code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{getApiBase() || window.location.origin + "（同源）"}</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 9. General ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "general" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">执行模式偏好</div>
                <div className="settings-card-row">
                  <div className="settings-card-info">
                    <div className="settings-card-label">默认推理规划模式</div>
                    <div className="settings-card-desc">
                      设置会话启动时默认使用的模式（智能体规划模式或直接执行模式）。
                    </div>
                  </div>
                  <CustomSelect<ExecutionMode>
                    value={settings.defaultExecutionMode ?? "review_before_edit"}
                    options={[
                      { value: "review_before_edit", label: "人工审批模式 (Review Before Edit)", subLabel: "改动前需确认" },
                      { value: "auto_edit", label: "快速自推进模式 (Auto Edit)", subLabel: "自动连续编辑" },
                      { value: "planning", label: "系统规划模式 (Planning Mode)", subLabel: "先生成方案" },
                      { value: "full_access", label: "完全信任模式 (Full Access)", subLabel: "免审批全权限" },
                    ]}
                    onChange={(mode) => {
                      onUpdate({
                        defaultExecutionMode: mode,
                        defaultPlannerType: mode === "planning" ? "planning" : "conversational",
                      });
                      flashSaved();
                    }}
                    style={{ width: "240px", maxWidth: "100%" }}
                  />
                </div>
              </div>

              <div className="settings-card-group">
                <div className="settings-card-group-title">通知与提示音</div>
                <div className="settings-card-row" style={{ alignItems: "center" }}>
                  <div className="settings-card-info">
                    <div className="settings-card-label">桌面推送与完成声音</div>
                    <div className="settings-card-desc">
                      当后台长任务执行完毕或需要权限审批时发出通知与提示音。
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn-capability-action"
                      style={{
                        padding: "5px 12px",
                        fontSize: "12px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setPlayingTestSound(true);
                        playNotificationSound("crystal");
                        setTimeout(() => setPlayingTestSound(false), 800);
                      }}
                      title="试听完成提示音"
                    >
                      <IconVolume size={14} />
                      <span>{playingTestSound ? "播放中..." : "播放声音"}</span>
                    </button>
                    <label className="settings-switch" title={settings.browserNotificationsEnabled ? "已启用桌面通知与提示音" : "已禁用桌面通知与提示音"}>
                      <input
                        type="checkbox"
                        checked={settings.browserNotificationsEnabled}
                        onChange={async (e) => {
                          if (e.target.checked) {
                            try {
                              await requestBrowserNotificationPermission();
                            } catch {}
                            onUpdate({ browserNotificationsEnabled: true });
                            playNotificationSound("crystal");
                          } else {
                            onUpdate({ browserNotificationsEnabled: false });
                          }
                          flashSaved();
                        }}
                      />
                      <span className="settings-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 10. Appearance ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "appearance" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">外观模式</div>
                <div className="settings-card-row">
                  <div className="settings-card-info">
                    <div className="settings-card-label">主题外观</div>
                    <div className="settings-card-desc">选择浅色、深色或跟随系统外观主题。</div>
                  </div>
                  <div className="theme-segmented-control" role="radiogroup" aria-label="主题外观">
                    <button
                      type="button"
                      className={`theme-segment-btn ${settings.theme === "system" ? "active" : ""}`}
                      onClick={() => {
                        onUpdate({ theme: "system" });
                        document.documentElement.setAttribute("data-theme", "system");
                        flashSaved();
                      }}
                    >
                      <IconMonitor size={15} />
                      <span>跟随系统</span>
                    </button>
                    <button
                      type="button"
                      className={`theme-segment-btn ${settings.theme === "light" ? "active" : ""}`}
                      onClick={() => {
                        onUpdate({ theme: "light" });
                        document.documentElement.setAttribute("data-theme", "light");
                        flashSaved();
                      }}
                    >
                      <IconSun size={15} />
                      <span>浅色</span>
                    </button>
                    <button
                      type="button"
                      className={`theme-segment-btn ${(settings.theme ?? "dark") === "dark" ? "active" : ""}`}
                      onClick={() => {
                        onUpdate({ theme: "dark" });
                        document.documentElement.setAttribute("data-theme", "dark");
                        flashSaved();
                      }}
                    >
                      <IconMoon size={15} />
                      <span>深色</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 11. Models & Usage ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "models" && (
            <div className="settings-section-container">
              {/* Gemini Models */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <div className="section-header-title-wrap">
                    <span className="section-header-title">{quotaData.geminiGroupName}</span>
                    <span title={quotaData.geminiGroupDesc}><IconInfo size={13} className="info-icon" /></span>
                  </div>
                  <button type="button" onClick={handleRefreshQuota} className={`btn-section-refresh ${quotaRefreshSuccess ? "btn-section-refresh-success" : ""}`} disabled={quotaRefreshing}>
                    <IconRefresh size={11} className={quotaRefreshing ? "icon-spin" : ""} />
                    <span>
                      {quotaRefreshing
                        ? "正在刷新..."
                        : quotaRefreshSuccess
                          ? `✓ 已更新 (${quotaLastRefreshed?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
                          : "刷新额度"}
                    </span>
                  </button>
                </div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">每周剩余额度</div>
                      <div className="settings-official-desc">
                        {quotaData.geminiWeeklyPct >= 100
                          ? "每周额度充足，将在 7 天后完整重置。"
                          : `您已使用部分每周额度（剩余 ${quotaData.geminiWeeklyPct}%），${formatQuotaResetTime(quotaData.geminiWeeklyReset, 168, true)}`}
                      </div>
                    </div>
                    <div className="quota-ring-container">
                      <span className="quota-ring-percent">{quotaData.geminiWeeklyPct}%</span>
                      <CircularProgressRing fraction={quotaData.geminiWeeklyFraction} size={22} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">5 小时动态剩余额度</div>
                      <div className="settings-official-desc">
                        {quotaData.gemini5hPct >= 100
                          ? `5 小时额度充足，${formatQuotaResetTime(quotaData.gemini5hReset, 5, false)}`
                          : `您已使用部分 5 小时额度（剩余 ${quotaData.gemini5hPct}%），${formatQuotaResetTime(quotaData.gemini5hReset, 5, false)}`}
                      </div>
                    </div>
                    <div className="quota-ring-container">
                      <span className="quota-ring-percent">{quotaData.gemini5hPct}%</span>
                      <CircularProgressRing fraction={quotaData.gemini5hFraction} size={22} strokeWidth={2.5} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Claude and GPT models */}
              <div className="settings-card-group">
                <div className="settings-card-group-title section-header-row">
                  <div className="section-header-title-wrap">
                    <span className="section-header-title">{quotaData.claudeGroupName}</span>
                    <span title={quotaData.claudeGroupDesc}><IconInfo size={13} className="info-icon" /></span>
                  </div>
                </div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">每周剩余额度</div>
                      <div className="settings-official-desc">
                        {quotaData.claudeWeeklyPct >= 100
                          ? "每周额度充足，将在 7 天后完整重置。"
                          : `您已使用部分每周额度（剩余 ${quotaData.claudeWeeklyPct}%），${formatQuotaResetTime(quotaData.claudeWeeklyReset, 168, true)}`}
                      </div>
                    </div>
                    <div className="quota-ring-container">
                      <span className="quota-ring-percent">{quotaData.claudeWeeklyPct}%</span>
                      <CircularProgressRing fraction={quotaData.claudeWeeklyFraction} size={22} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">5 小时动态剩余额度</div>
                      <div className="settings-official-desc">
                        {quotaData.claude5hPct >= 100
                          ? `5 小时额度充足，${formatQuotaResetTime(quotaData.claude5hReset, 5, false)}`
                          : `您已使用部分 5 小时额度（剩余 ${quotaData.claude5hPct}%），${formatQuotaResetTime(quotaData.claude5hReset, 5, false)}`}
                      </div>
                    </div>
                    <div className="quota-ring-container">
                      <span className="quota-ring-percent">{quotaData.claude5hPct}%</span>
                      <CircularProgressRing fraction={quotaData.claude5hFraction} size={22} strokeWidth={2.5} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Default Model Preference */}
              <div className="settings-card-group">
                <div className="settings-card-group-title">默认模型偏好</div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">首选模型选择</div>
                      <div className="settings-official-desc">新建会话时将自动优先绑定此模型</div>
                    </div>
                    <CustomSelect<string>
                      value={settings.defaultModel ?? "__none__"}
                      options={[{ value: "__none__", label: "自动智能推荐 (官方推荐)" }]}
                      groups={modelSelectGroups}
                      onChange={(val) => {
                        onUpdate({ defaultModel: val === "__none__" ? null : val });
                        flashSaved();
                      }}
                      style={{ width: "240px", maxWidth: "100%" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 12. Browser ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "browser" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">Chrome DevTools 网页自动化控制</div>
                <div className="settings-card-row">
                  <div className="settings-card-info">
                    <div className="settings-card-label">页面审查与网页交互</div>
                    <div className="settings-card-desc">允许智能体执行点击、输入、截屏与性能诊断</div>
                  </div>
                  <span className={`customization-status-badge mcp ${
                    healthData?.languageServers && healthData.languageServers.length > 0 ? "" : "disabled"
                  }`}>
                    {healthData?.languageServers && healthData.languageServers.length > 0 ? "● 已就绪" : "○ 软件未连接"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 13. App ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "app" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">应用与版本信息</div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">Porta 客户端版本</div>
                      <div className="settings-official-desc">专为 Google Antigravity & Codex 打造的 Web / 移动端伴侣</div>
                    </div>
                    <div className="settings-card-badge-val">v1.2.0 (全功能版)</div>
                  </div>
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">本地缓存管理</div>
                      <div className="settings-official-desc">清理 Service Worker 离线资源与缓存数据</div>
                    </div>
                    <button
                      className="btn-google-signout"
                      onClick={() => {
                        if ("caches" in window) {
                          caches.keys().then((names) => {
                            names.forEach((name) => caches.delete(name));
                          });
                        }
                        flashSaved();
                      }}
                    >
                      清除缓存
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════ */}
          {/* ── 14. Status ── */}
          {/* ══════════════════════════════════════════════════════ */}
          {activeTab === "status" && (
            <div className="settings-section-container">
              <div className="settings-card-group">
                <div className="settings-card-group-title">语言服务与项目状态</div>
                <div className="settings-official-card">
                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">语言服务代理连接</div>
                      <div className="settings-official-desc">与本地 Language Server 的实时连接状态</div>
                    </div>
                    <span className="settings-status-online">● 连接正常 (200 OK)</span>
                  </div>

                  <div className="settings-official-row">
                    <div className="settings-official-info">
                      <div className="settings-official-label">已监控工作区总数</div>
                      <div className="settings-official-desc">语言服务当前实时监控的项目工作区数量</div>
                    </div>
                    <div className="settings-card-badge-val">{workspaces.length} 个工作区</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════ */}
        {/* ── Modals & Dialogs ── */}
        {/* ══════════════════════════════════════════════════════ */}

        {/* 1. Skill Markdown Viewer Modal */}
        {inspectingSkill && (
          <div className="shortcuts-modal-overlay" onClick={() => setInspectingSkill(null)}>
            <div className="skill-doc-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-dialog-header">
                <div className="shortcuts-dialog-title">
                  <IconWand size={18} />
                  <span>{inspectingSkill.title} ({inspectingSkill.name})</span>
                </div>
                <button className="shortcuts-close-btn" onClick={() => setInspectingSkill(null)}>
                  <IconX size={16} />
                </button>
              </div>
              <div className="skill-doc-body">
                {loadingSkillContent ? (
                  <div className="skill-loading-state">⏳ 正在读取 SKILL.md 文档...</div>
                ) : (
                  <>
                    <pre className="skill-markdown-view">{skillContent?.markdown}</pre>
                    {skillContent?.scripts && skillContent.scripts.length > 0 && (
                      <div className="skill-aux-section">
                        <div className="skill-aux-title">包含辅助脚本：</div>
                        <div className="skill-aux-tags">
                          {skillContent.scripts.map((s) => (
                            <span key={s} className="mini-badge">📜 {s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. Memory Editor Modal */}
        {editingMemory && (
          <div className="shortcuts-modal-overlay" onClick={() => setEditingMemory(null)}>
            <div className="memory-editor-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-dialog-header">
                <div className="shortcuts-dialog-title">
                  <IconBrain size={18} />
                  <span>编辑记忆指令: {editingMemory.name}</span>
                </div>
                <button className="shortcuts-close-btn" onClick={() => setEditingMemory(null)}>
                  <IconX size={16} />
                </button>
              </div>
              <div className="memory-editor-body">
                <div className="memory-editor-path">文件路径: <code>{editingMemory.path}</code></div>
                <textarea
                  className="memory-textarea"
                  value={editMemoryContent}
                  onChange={(e) => setEditMemoryContent(e.target.value)}
                  rows={14}
                />
              </div>
              <div className="memory-editor-footer">
                {memorySaveStatus === "ok" && <span className="save-status-badge ok">✓ 已保存到本地文件</span>}
                {memorySaveStatus === "error" && <span className="save-status-badge error">✕ 保存失败，请检查写入权限</span>}
                <button className="btn-pill-secondary" onClick={() => setEditingMemory(null)}>取消</button>
                <button
                  className="btn-pill-primary"
                  disabled={memorySaveStatus === "saving"}
                  onClick={handleSaveMemory}
                >
                  {memorySaveStatus === "saving" ? "正在保存..." : "保存记忆"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. Keyboard Shortcuts Modal */}
        {showShortcutsModal && (
          <div className="shortcuts-modal-overlay" onClick={() => setShowShortcutsModal(false)}>
            <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-dialog-header">
                <div className="shortcuts-dialog-title">
                  <IconKeyboard size={18} />
                  <span>键盘快捷键指南</span>
                </div>
                <button className="shortcuts-close-btn" onClick={() => setShowShortcutsModal(false)}>
                  <IconX size={16} />
                </button>
              </div>
              <div className="shortcuts-table">
                <div className="shortcut-row">
                  <span className="shortcut-desc">发送消息</span>
                  <span className="shortcut-key">Enter</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-desc">换行</span>
                  <span className="shortcut-key">Shift + Enter</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-desc">唤起指令补全</span>
                  <span className="shortcut-key">/</span>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-desc">提及上下文文件</span>
                  <span className="shortcut-key">@</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. Subagent Editor Modal */}
        {showAgentEditor && (
          <div className="shortcuts-modal-overlay" onClick={() => setShowAgentEditor(false)}>
            <div className="subagent-editor-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-dialog-header">
                <div className="shortcuts-dialog-title">
                  <IconBot size={18} style={{ color: "#a855f7" }} />
                  <span>{editingAgent ? `编辑智能体: ${editingAgent.name}` : "新建自定义子智能体"}</span>
                </div>
                <button className="shortcuts-close-btn" onClick={() => setShowAgentEditor(false)}>
                  <IconX size={16} />
                </button>
              </div>

              {/* Presets Toolbar (Only for new agent) */}
              {!editingAgent && (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "4px" }}>快速填充模版：</div>
                  <div className="preset-templates-bar">
                    <button
                      type="button"
                      className="preset-template-btn"
                      onClick={() => {
                        setAgentFormName("code-reviewer");
                        setAgentFormRole("代码架构与安全审查员");
                        setAgentFormDesc("专门负责对提交代码进行质量审查、架构规范检查并提出改进建议。");
                        setAgentFormTools(["view_file", "grep_search", "find_by_name", "list_dir"]);
                        setAgentFormPrompt(`You are an expert code reviewer subagent.\nReview code strictly for:\n1. Architecture consistency\n2. Bugs and edge cases\n3. Performance & security vulnerabilities\nOutput clear, constructive diff feedback.`);
                      }}
                    >
                      🔍 代码审查专家
                    </button>
                    <button
                      type="button"
                      className="preset-template-btn"
                      onClick={() => {
                        setAgentFormName("doc-researcher");
                        setAgentFormRole("官方文档与技术调研员");
                        setAgentFormDesc("负责在线检索最新技术文档、官方 API 规范并生成总结。");
                        setAgentFormTools(["view_file", "search_web", "read_url_content", "find_by_name"]);
                        setAgentFormPrompt(`You are a dedicated documentation and technology researcher.\nInvestigate latest docs, API references, and migration guides.\nProvide concise, verified synthesis.`);
                      }}
                    >
                      📚 文档调研员
                    </button>
                    <button
                      type="button"
                      className="preset-template-btn"
                      onClick={() => {
                        setAgentFormName("fast-builder");
                        setAgentFormRole("精准修改与重构员");
                        setAgentFormDesc("快速执行 1-2 个代码文件的精准修改、语法重构与测试修复。");
                        setAgentFormTools(["view_file", "read_file", "write_to_file", "grep_search"]);
                        setAgentFormPrompt(`You are a fast precision builder.\nApply minimal, surgical edits to target files.\nVerify code syntax and return clear diffs.`);
                      }}
                    >
                      ⚡ 精准修改员
                    </button>
                    <button
                      type="button"
                      className="preset-template-btn"
                      onClick={() => {
                        setAgentFormName("db-optimizer");
                        setAgentFormRole("数据库与 SQL 调优师");
                        setAgentFormDesc("分析数据库 Schema 设计、索引策略与复杂查询优化。");
                        setAgentFormTools(["view_file", "grep_search", "read_file"]);
                        setAgentFormPrompt(`You are a database and query optimization expert.\nAnalyze schemas, indexes, and execution plans to provide optimized queries.`);
                      }}
                    >
                      🗄️ SQL 调优师
                    </button>
                  </div>
                </div>
              )}

              {/* Form */}
              <div className="subagent-editor-form">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="form-field-group">
                    <label className="form-field-label">智能体标识 (Name/ID)*</label>
                    <input
                      type="text"
                      className="form-field-input"
                      placeholder="如: custom-builder"
                      value={agentFormName}
                      disabled={!!editingAgent}
                      onChange={(e) => setAgentFormName(e.target.value)}
                    />
                  </div>
                  <div className="form-field-group">
                    <label className="form-field-label">职责角色 (Role)*</label>
                    <input
                      type="text"
                      className="form-field-input"
                      placeholder="如: 代码审查专家"
                      value={agentFormRole}
                      onChange={(e) => setAgentFormRole(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-field-group">
                  <label className="form-field-label">一句话功能描述</label>
                  <input
                    type="text"
                    className="form-field-input"
                    placeholder="描述该智能体的具体应用场景与专长..."
                    value={agentFormDesc}
                    onChange={(e) => setAgentFormDesc(e.target.value)}
                  />
                </div>

                <div className="form-field-group">
                  <label className="form-field-label">授权工具集 (可多选)</label>
                  <div className="tools-selector-grid">
                    {[
                      "view_file",
                      "read_file",
                      "write_to_file",
                      "run_command",
                      "grep_search",
                      "find_by_name",
                      "list_dir",
                      "search_web",
                      "read_url_content",
                      "mcp_tools",
                    ].map((tool) => {
                      const isSelected = agentFormTools.includes(tool);
                      return (
                        <button
                          key={tool}
                          type="button"
                          className={`tool-select-chip ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setAgentFormTools(agentFormTools.filter((t) => t !== tool));
                            } else {
                              setAgentFormTools([...agentFormTools, tool]);
                            }
                          }}
                        >
                          {isSelected && <IconCheck size={11} />}
                          <span>{tool}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-field-group">
                  <label className="form-field-label">系统提示词 (System Prompt Instructions Markdown)</label>
                  <textarea
                    className="form-field-textarea"
                    placeholder="输入该智能体的系统设定、行为规范与任务指令..."
                    value={agentFormPrompt}
                    onChange={(e) => setAgentFormPrompt(e.target.value)}
                    rows={6}
                  />
                </div>
              </div>

              {/* Dialog Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
                <button
                  type="button"
                  className="btn-pill-secondary"
                  onClick={() => setShowAgentEditor(false)}
                  disabled={agentFormSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-pill-primary"
                  onClick={handleSaveAgent}
                  disabled={agentFormSaving || !agentFormName.trim()}
                >
                  {agentFormSaving ? "保存中..." : editingAgent ? "更新智能体" : "创建并保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 6. Feedback Modal */}
        {showFeedbackModal && (
          <div className="shortcuts-modal-overlay" onClick={() => setShowFeedbackModal(false)}>
            <div className="feedback-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-dialog-header">
                <div className="shortcuts-dialog-title">
                  <IconMessageSquare size={18} />
                  <span>意见与体验反馈</span>
                </div>
                <button className="shortcuts-close-btn" onClick={() => setShowFeedbackModal(false)}>
                  <IconX size={16} />
                </button>
              </div>
              {feedbackSent ? (
                <div className="feedback-success-state">
                  <IconCheck size={32} />
                  <p>感谢您的反馈！我们将持续打磨产品体验。</p>
                </div>
              ) : (
                <>
                  <textarea
                    className="feedback-textarea"
                    placeholder="请描述您遇到的问题或期望改进的功能..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    rows={4}
                  />
                  <div className="feedback-dialog-actions">
                    <button className="btn-pill-secondary" onClick={() => setShowFeedbackModal(false)}>
                      取消
                    </button>
                    <button
                      className="btn-pill-primary"
                      onClick={() => {
                        if (!feedbackText.trim()) return;
                        setFeedbackSent(true);
                        setTimeout(() => {
                          setShowFeedbackModal(false);
                          setFeedbackText("");
                          setFeedbackSent(false);
                        }, 1500);
                      }}
                    >
                      提交反馈
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showSetupWizardLocal &&
        createPortal(
          <SetupWizard
            onClose={() => {
              setShowSetupWizardLocal(false);
              setCustomServerUrl(getApiBase());
            }}
          />,
          document.body
        )}
    </>
  );
}
