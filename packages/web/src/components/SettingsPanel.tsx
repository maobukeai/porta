/**
 * Antigravity Full Settings Panel (全功能汉化高级版)
 * Replicates the complete official settings interface with real data integration and full Chinese localization.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import {
  IconCheck,
  IconMonitor,
  IconSun,
  IconMoon,
  IconSparkles,
  IconSliders,
  IconPuzzle,
  IconKeyboard,
  IconMessageSquare,
  IconChevronLeft,
  IconX,
  IconInfo,
  IconRefresh,
} from "./Icons";
import { api, getApiBase, setCustomApiBase } from "../api/client";
import { SetupWizard } from "./SetupWizard";
import {
  requestBrowserNotificationPermission,
  showBrowserNotification,
  playNotificationSound,
} from "../utils/browserNotifications";
import type { ClientSettings } from "../types";
import type { PlannerType } from "./ChatInput";

interface ModelConfig {
  label: string;
  modelOrAlias: { model: string };
  supportsImages: boolean;
  isRecommended: boolean;
  quotaInfo?: { remainingFraction: number };
}

interface ParsedModelOption {
  id: string;
  fullName: string;
  baseName: string;
  tier: "High" | "Medium" | "Low" | "Thinking" | null;
  supportsImages: boolean;
  isRecommended: boolean;
  quota: number;
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

type SettingsTab =
  | "account"
  | "general"
  | "appearance"
  | "models"
  | "customizations"
  | "browser"
  | "app"
  | "status";

const SETTINGS_MENU_ITEMS: { id: SettingsTab; label: string; mobileLabel: string }[] = [
  { id: "account", label: "账户设置", mobileLabel: "账户" },
  { id: "general", label: "常规设置", mobileLabel: "常规" },
  { id: "appearance", label: "主题外观", mobileLabel: "外观" },
  { id: "models", label: "模型与用量", mobileLabel: "模型" },
  { id: "customizations", label: "扩展技能", mobileLabel: "技能" },
  { id: "browser", label: "浏览器控制", mobileLabel: "浏览器" },
  { id: "app", label: "应用与缓存", mobileLabel: "应用" },
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [enableTelemetry, setEnableTelemetry] = useState(false);
  const [marketingEmails, setMarketingEmails] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState<string>(() => getApiBase());
  const [proxyStatus, setProxyStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [healthData, setHealthData] = useState<import("../types").HealthResponse | null>(null);
  const [showSetupWizardLocal, setShowSetupWizardLocal] = useState(false);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeTab]);

  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const [userEmail, setUserEmail] = useState<string>("");
  const [userPlan, setUserPlan] = useState<string>("");

  const disabledSkills = useMemo(() => new Set(settings.disabledSkills ?? []), [settings.disabledSkills]);
  const disabledMcpTools = useMemo(() => new Set(settings.disabledMcpTools ?? []), [settings.disabledMcpTools]);

  const toggleSkill = useCallback((skillName: string) => {
    const next = new Set(disabledSkills);
    if (next.has(skillName)) {
      next.delete(skillName);
    } else {
      next.add(skillName);
    }
    onUpdate({ disabledSkills: Array.from(next) });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }, [disabledSkills, onUpdate]);

  const toggleMcpTool = useCallback((toolName: string) => {
    const next = new Set(disabledMcpTools);
    if (next.has(toolName)) {
      next.delete(toolName);
    } else {
      next.add(toolName);
    }
    onUpdate({ disabledMcpTools: Array.from(next) });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }, [disabledMcpTools, onUpdate]);

  const [liveSkills, setLiveSkills] = useState<Array<{ name: string; description: string; source: string }>>([]);
  const [liveMcpServers, setLiveMcpServers] = useState<Array<{ name: string; description: string }>>([]);

  const isMountedRef = useRef(true);

  const fetchCustomizations = useCallback(async () => {
    try {
      const data = await api.customizations();
      if (!isMountedRef.current) return; // guard against unmounted setState
      if (Array.isArray(data.skills) && data.skills.length > 0) {
        setLiveSkills(data.skills);
      }
      if (Array.isArray(data.mcpServers) && data.mcpServers.length > 0) {
        setLiveMcpServers(data.mcpServers);
      }
    } catch (err) {
      console.warn("Failed to fetch dynamic customizations:", err);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.health();
      if (!isMountedRef.current) return; // guard against unmounted setState
      setHealthData(data);
    } catch (err) {
      console.warn("Failed to fetch health status:", err);
    }
  }, []);

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
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
      const data = await api.userStatus();
      if (data?.userStatus?.email) {
        setUserEmail(data.userStatus.email);
      }
      if (data?.userStatus?.userTier?.name || data?.userStatus?.planStatus) {
        setUserPlan(data.userStatus.userTier?.name || data.userStatus.planStatus || "");
      }
      const liveConfigs = data?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
      if (Array.isArray(liveConfigs) && liveConfigs.length > 0) {
        setModels(liveConfigs as ModelConfig[]);
      }
    } catch (err) {
      console.warn("Failed to fetch user status:", err);
    }
  }, []);

  const [quotaRefreshing, setQuotaRefreshing] = useState(false);

  const skillsToDisplay = useMemo(() => {
    if (liveSkills.length > 0) {
      return liveSkills.map((s) => ({
        name: s.name,
        // Build a friendly display label from the skill's machine name
        label: s.name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        // Source badge shown separately
        tag: s.source === "builtin" ? "内置" : "扩展",
        desc: s.description,
      }));
    }
    return [
      { name: "frontend_design", label: "前端极致设计", tag: "内置", desc: "构建兼具高端设计感与生产级别的独特前端界面，避开平庸排版。" },
      { name: "ui-ux-pro-max", label: "UI/UX 智能体", tag: "内置", desc: "内置 50+ 风格、161+ 色板、57+ 字体与 99+ 条核心设计指南。" },
      { name: "brainstorming", label: "深度头脑风暴", tag: "内置", desc: "在动手开发前深入探索用户意图、技术架构与多维度方案设计。" },
      { name: "systematic-debugging", label: "系统化调试", tag: "内置", desc: "严密追溯 Bug 根因，系统化推导代码修复与防御策略。" },
      { name: "test-driven-development", label: "测试驱动开发", tag: "内置", desc: "在实现新功能前编写严格的断言与单元测试逻辑。" },
      { name: "subagent-driven-development", label: "子代理并行", tag: "内置", desc: "多任务并行调度独立子智能体，执行无状态依赖的复合规划。" },
      { name: "executing-plans", label: "计划执行器", tag: "内置", desc: "按实施步骤逐项验收并推进大型开发里程碑。" },
    ];
  }, [liveSkills]);

  const mcpToDisplay = useMemo(() => {
    if (liveMcpServers.length > 0) {
      return liveMcpServers.map((m) => ({
        name: m.name,
        desc: m.description,
      }));
    }
    return [
      { name: "blender-mcp", desc: "3D 资产建模、渲染调度、Polyhaven 与 Sketchfab 模型检索集成。" },
      { name: "chrome-devtools-mcp", desc: "原生自动化网页交互、DOM 检查、Console 日志抓取与截屏审查。" },
      { name: "eagle-mcp", desc: "Eagle 设计资源库与素材管理集成。" },
      { name: "github-mcp-server", desc: "GitHub 仓库检索、分支建立、PR 自动创建与代码合并自动化。" },
      { name: "prisma-mcp-server", desc: "Prisma 数据库迁移状态监控与 Prisma Studio 调试可视化。" },
      { name: "sequential-thinking", desc: "Sequential Thinking 顺序思考与复杂逻辑推理引擎。" },
      { name: "StitchMCP", desc: "Stitch UI 设计稿自动缝合与代码转换引擎。" },
      { name: "videostudio-tutorial", desc: "自动化视频教程录制、片段合成与渲染流水线。" },
    ];
  }, [liveMcpServers]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchModels();
    fetchUserStatus();
    fetchHealth();
    fetchCustomizations();
    const timer = setInterval(() => {
      fetchHealth();
      fetchCustomizations();
    }, 3000);
    return () => {
      isMountedRef.current = false; // prevent setState after unmount
      clearInterval(timer);
    };
  }, [fetchModels, fetchUserStatus, fetchHealth, fetchCustomizations]);

  const handleRefreshQuota = useCallback(async () => {
    setQuotaRefreshing(true);
    await Promise.all([fetchModels(1), fetchUserStatus()]);
    setTimeout(() => setQuotaRefreshing(false), 500);
  }, [fetchModels, fetchUserStatus]);

  const quotaData = useMemo(() => {
    const geminiModels = models.filter(
      (m) =>
        m.label?.toLowerCase().includes("gemini") ||
        m.modelOrAlias?.model?.toLowerCase().includes("gemini")
    );
    const claudeGptModels = models.filter(
      (m) =>
        m.label?.toLowerCase().includes("claude") ||
        m.label?.toLowerCase().includes("gpt") ||
        m.modelOrAlias?.model?.toLowerCase().includes("claude") ||
        m.modelOrAlias?.model?.toLowerCase().includes("gpt")
    );

    // Find recommended/active high tier Gemini Flash & Gemini Pro models
    const geminiFlashHigh = geminiModels.find(
      (m) =>
        m.isRecommended ||
        m.modelOrAlias?.model?.includes("flash-high") ||
        m.label?.toLowerCase().includes("high")
    );
    const geminiPro = geminiModels.find(
      (m) =>
        m.modelOrAlias?.model?.includes("pro") ||
        m.label?.toLowerCase().includes("pro")
    );

    const mainGeminiModel = geminiFlashHigh || geminiModels[0];

    const rawGemini5h = mainGeminiModel?.quotaInfo?.remainingFraction;
    const rawGeminiWeekly = geminiPro?.quotaInfo?.remainingFraction ?? rawGemini5h;

    const geminiWeeklyPct =
      rawGeminiWeekly !== undefined ? Math.round(rawGeminiWeekly * 100) : 100;

    const gemini5hPct =
      rawGemini5h !== undefined ? Math.round(rawGemini5h * 100) : 100;

    const rawClaudeWeekly = claudeGptModels[0]?.quotaInfo?.remainingFraction;
    const rawClaude5h =
      claudeGptModels[1]?.quotaInfo?.remainingFraction ?? rawClaudeWeekly;

    const claudeWeeklyPct =
      rawClaudeWeekly !== undefined ? Math.round(rawClaudeWeekly * 100) : 100;
    const claude5hPct =
      rawClaude5h !== undefined ? Math.round(rawClaude5h * 100) : 100;

    return { geminiWeeklyPct, gemini5hPct, claudeWeeklyPct, claude5hPct };
  }, [models]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Parse models sorted by quality/tier
  const parsedModels: ParsedModelOption[] = useMemo(() => {
    const list = models
      .filter((m) => m.modelOrAlias?.model) // skip malformed entries missing modelOrAlias
      .map((m) => {
        const label = m.label || m.modelOrAlias?.model || "";
        const match = label.match(/^(.*?)(?:\s*\((Low|Medium|High|Thinking)\))?$/i);
        const baseName = match ? match[1].trim() : label;
        const rawTier = match && match[2] ? match[2] : null;
        let tier: ParsedModelOption["tier"] = null;
        if (rawTier) {
          tier = (rawTier.charAt(0).toUpperCase() + rawTier.slice(1).toLowerCase()) as any;
        }
        const quota =
          m.quotaInfo?.remainingFraction !== undefined
            ? m.quotaInfo.remainingFraction
            : 1.0;

        return {
          id: m.modelOrAlias?.model ?? "",
          fullName: label,
          baseName,
          tier,
          supportsImages: !!m.supportsImages,
          isRecommended: !!m.isRecommended,
          quota,
        };
      });

    const getVersionScore = (name: string, tier: string | null) => {
      let score = 0;
      if (name.includes("3.6")) score += 300;
      else if (name.includes("4.6")) score += 250;
      else if (name.includes("3.5")) score += 200;
      else if (name.includes("3.1")) score += 100;

      if (tier === "High" || tier === "Thinking") score += 30;
      else if (tier === "Medium") score += 20;
      else if (tier === "Low") score += 10;
      return score;
    };

    return list.sort((a, b) => {
      const sA = getVersionScore(a.fullName, a.tier);
      const sB = getVersionScore(b.fullName, b.tier);
      if (sA !== sB) return sB - sA;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [models]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      const value = modelId === "__none__" ? null : modelId;
      onUpdate({ defaultModel: value });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handlePlannerChange = useCallback(
    (value: PlannerType) => {
      onUpdate({ defaultPlannerType: value });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handleToggleNotifications = useCallback(async () => {
    if (!settings.browserNotificationsEnabled) {
      const perm = await requestBrowserNotificationPermission();
      if (perm === "granted") {
        onUpdate({ browserNotificationsEnabled: true });
        flashSaved();
        playNotificationSound();
        showBrowserNotification({
          title: "Porta 系统通知与声音提示已开启",
          body: "当长时间任务完成或需要审批时，将弹出系统通知并播放提示音。",
          playSound: true,
        });
      }
    } else {
      onUpdate({ browserNotificationsEnabled: false });
      flashSaved();
    }
  }, [settings.browserNotificationsEnabled, onUpdate, flashSaved]);

  const handleThemeChange = (theme: "dark" | "light" | "system") => {
    onUpdate({ theme });
    flashSaved();
    document.documentElement.setAttribute("data-theme", theme);
  };

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) return;
    setFeedbackSent(true);
    setTimeout(() => {
      setShowFeedbackModal(false);
      setFeedbackText("");
      setFeedbackSent(false);
    }, 1500);
  };

  const displayedProjects = showAllProjects ? workspaces : workspaces.slice(0, 4);

  return (
    <>
    <div className="settings-panel">
      {/* ── Mobile Navigation Header (Shown only on <=768px) ── */}
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
          {SETTINGS_MENU_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                ref={isActive ? activeTabRef : null}
                className={`settings-mobile-tab-btn ${isActive ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span>{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Desktop Left Sidebar (>=769px) ── */}
      <div className="settings-sidebar">
        <div className="settings-sidebar-top">
          {/* Section: Settings */}
          <div className="settings-nav-group">
            <div className="settings-group-header">系统偏好设置</div>
            <nav className="settings-nav">
              {SETTINGS_MENU_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    className={`settings-nav-item ${isActive ? "active" : ""}`}
                    onClick={() => setActiveTab(item.id)}
                  >
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

          {/* Section: Not in Project */}
          <div className="settings-nav-group">
            <div className="settings-group-header">未关联项目</div>
            <div className="settings-nav">
              <button
                className="settings-nav-item"
                onClick={() => {
                  if (conversations[0]?.id && onSelectChat) {
                    onSelectChat(conversations[0].id);
                  }
                  onBack();
                }}
              >
                <span>历史对话记录</span>
              </button>
            </div>
          </div>
        </div>

        <div className="settings-sidebar-bottom">
          <button
            className="settings-quick-link"
            onClick={() => setShowShortcutsModal(true)}
          >
            <span>快捷键指南</span>
          </button>
          <button
            className="settings-quick-link"
            onClick={() => setShowFeedbackModal(true)}
          >
            <span>意见与反馈</span>
          </button>
        </div>
      </div>

      {/* ── Right Content Area ── */}
      <div className="settings-content">
        <div className="settings-content-header">
          <div>
            <h1 className="settings-main-title">
              {activeTab === "account" && "账户设置"}
              {activeTab === "general" && "常规设置"}
              {activeTab === "appearance" && "主题外观"}
              {activeTab === "models" && "模型与用量"}
              {activeTab === "customizations" && "扩展技能与指令"}
              {activeTab === "browser" && "浏览器控制"}
              {activeTab === "app" && "应用与离线缓存"}
              {activeTab === "status" && "服务与节点状态"}
            </h1>
            <p className="settings-subtitle">
              {activeTab === "account" && "管理您的订阅方案、开发者凭证与账户偏好。"}
              {activeTab === "general" && "配置默认推理规划模式、桌面推送通知与全局偏好重置。"}
              {activeTab === "appearance" && "选择界面显示主题（浅色模式、深色模式或跟随系统）。"}
              {activeTab === "models" && "查看 API 推理模型额度、多模态支持与首选模型。"}
              {activeTab === "customizations" && "配置 Antigravity 超级技能、MCP 工具服务与快捷指令。"}
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

        {/* ── Tab 1: Account ── */}
        {activeTab === "account" && (
          <div className="settings-section-container">
            {/* General Section */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">通用偏好</div>
              <div className="settings-official-card">
                {/* Row 1: Enable Telemetry */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">启用遥测数据</div>
                    <div className="settings-official-desc">
                      开启后，Antigravity 将收集匿名使用数据以帮助 Google 提升产品性能与特性。
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={enableTelemetry}
                      onChange={(e) => {
                        setEnableTelemetry(e.target.checked);
                        flashSaved();
                      }}
                      aria-label="启用遥测数据"
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                {/* Row 2: Marketing Emails */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">营销与更新邮件</div>
                    <div className="settings-official-desc">
                      通过电子邮件接收 Google Antigravity 的产品更新、技巧和优惠通知。
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={marketingEmails}
                      onChange={(e) => {
                        setMarketingEmails(e.target.checked);
                        flashSaved();
                      }}
                      aria-label="营销与更新邮件"
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </div>

            {/* Account Section */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">账户凭证</div>
              <div className="settings-official-card">
                {/* Row 1: Your Plan */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">
                      当前订阅方案：{userPlan || "Google AI Pro"}
                    </div>
                    <div className="settings-official-desc">
                      您可以升级至 Google AI Ultra 方案以获取更高的速率限制与并发额度。
                    </div>
                  </div>
                  <button
                    className="btn-google-upgrade"
                    onClick={() => flashSaved()}
                  >
                    升级方案
                  </button>
                </div>

                {/* Row 2: Email */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">绑定邮箱</div>
                    <div className="settings-official-desc email-text">
                      {userEmail || "已连接 Antigravity IDE 实例"}
                    </div>
                  </div>
                  <button
                    className="btn-google-signout"
                    onClick={() => flashSaved()}
                  >
                    退出登录
                  </button>
                </div>

                {/* Row 3: Language Server Process */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">Language Server 引擎状态</div>
                    <div className="settings-official-desc">
                      {healthData?.languageServers && healthData.languageServers.length > 0
                        ? `进程 PID: ${healthData.languageServers[0].pid} · HTTPS 端口: ${healthData.languageServers[0].httpsPort}`
                        : "正在连接 Antigravity IDE 2.0+ 引擎..."}
                    </div>
                  </div>
                  <span className="settings-status-online">
                    {healthData?.status === "ok" ? "● 运行正常" : "○ 离线/校验中"}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer terms */}
            <div className="settings-official-footer">
              <span>使用本应用即表示您同意其 </span>
              <a
                href="https://policies.google.com/terms"
                target="_blank"
                rel="noreferrer"
                className="settings-terms-link"
              >
                服务条款 (Terms of Service)
              </a>
            </div>
          </div>
        )}

        {/* ── Tab 2: General ── */}
        {activeTab === "general" && (
          <div className="settings-section-container">
            <div className="settings-card-group">
              <div className="settings-card-group-title">规划器模式 (Planner Type)</div>
              <div className="settings-card-row">
                <div className="settings-card-info">
                  <div className="settings-card-label">默认规划执行模式</div>
                  <div className="settings-card-desc">
                    选择默认会话方式：快速直接执行（Fast）或深度思考规划（Planning）
                  </div>
                </div>
                <div className="theme-segmented-control">
                  <button
                    className={`theme-segment-btn ${
                      (settings.defaultPlannerType ?? "conversational") === "conversational"
                        ? "active"
                        : ""
                    }`}
                    onClick={() => handlePlannerChange("conversational")}
                  >
                    <IconSparkles size={13} />
                    <span>快速响应</span>
                  </button>
                  <button
                    className={`theme-segment-btn ${
                      settings.defaultPlannerType === "planning" ? "active" : ""
                    }`}
                    onClick={() => handlePlannerChange("planning")}
                  >
                    <IconSliders size={13} />
                    <span>深度规划</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-card-group">
              <div className="settings-card-group-title">消息通知与声音提示 (System & Sound Notifications)</div>
              <div className="settings-card-row notification-card-row">
                <div className="settings-card-info">
                  <div className="settings-card-label">系统级原生通知与音频提示音</div>
                  <div className="settings-card-desc">
                    在安卓 APP 或桌面端运行长时间任务/命令完成或需审批时，直接弹出系统原生通知并播放水晶音阶提示音
                  </div>
                </div>
                <div className="notification-row-actions">
                  <button
                    type="button"
                    className="btn-notification-test"
                    onClick={async () => {
                      await requestBrowserNotificationPermission();
                      playNotificationSound();
                      showBrowserNotification({
                        title: "✨ Porta 水晶提示音测试",
                        body: "测试成功！高阶水晶提示音与系统通知运行正常。",
                        playSound: true,
                      });
                    }}
                  >
                    ✨ 测试提示音
                  </button>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.browserNotificationsEnabled}
                      onChange={handleToggleNotifications}
                      aria-label="消息通知与声音提示"
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </div>

            {/* Section 3: Custom Proxy Server URL */}
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

                  {/* Input row */}
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click();
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
                        transition: "border-color 0.2s",
                      }}
                    />
                    <button
                      type="button"
                      className="btn-google-upgrade proxy-save-btn"
                      disabled={proxyStatus === "saving"}
                      style={{ height: 38, padding: "0 16px", fontSize: 13, flexShrink: 0, whiteSpace: "nowrap", opacity: proxyStatus === "saving" ? 0.7 : 1 }}
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
                    {customServerUrl && (
                      <button
                        type="button"
                        title="清除，恢复同源地址"
                        style={{
                          height: 38,
                          width: 38,
                          flexShrink: 0,
                          border: "1px solid var(--border-default)",
                          borderRadius: 8,
                          background: "var(--bg-tertiary)",
                          color: "var(--text-tertiary)",
                          fontSize: 16,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={() => {
                          setCustomServerUrl("");
                          setCustomApiBase("");
                          setProxyStatus("idle");
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Status row */}
                  {proxyStatus !== "idle" && (
                    <div style={{
                      fontSize: 12,
                      color: proxyStatus === "error" ? "rgb(239,68,68)" : proxyStatus === "ok" ? "var(--text-accent)" : "var(--text-tertiary)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      {proxyStatus === "saving" && "⏳ 正在连接并加载模型列表…"}
                      {proxyStatus === "ok" && "✅ 连接成功！已切换到新代理地址"}
                      {proxyStatus === "error" && "❌ 连接失败，请检查地址和网络"}
                    </div>
                  )}

                   {/* Current active address hint */}
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    当前使用地址：<code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{getApiBase() || window.location.origin + "（同源）"}</code>
                  </div>

                  {/* Re-open setup wizard (native only) */}
                  {Boolean((window as any).Capacitor?.isNativePlatform?.() || (window as any).Capacitor?.platform) && (
                    <button
                      type="button"
                      onClick={() => setShowSetupWizardLocal(true)}
                      style={{
                        marginTop: 4,
                        padding: "8px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: "1px solid var(--border-default)",
                        background: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        alignSelf: "flex-start",
                      }}
                    >
                      📡 重新打开连接向导
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 3: Appearance ── */}
        {activeTab === "appearance" && (
          <div className="settings-section-container">
            <div className="settings-card-group">
              <div className="settings-card-group-title">外观模式</div>
              <div className="settings-card-row">
                <div className="settings-card-info">
                  <div className="settings-card-label">主题外观</div>
                  <div className="settings-card-desc">
                    选择浅色、深色或跟随系统外观主题。
                  </div>
                </div>
                <div className="theme-segmented-control" role="radiogroup" aria-label="主题外观">
                  <button
                    type="button"
                    className={`theme-segment-btn ${
                      (settings.theme ?? "system") === "system" ? "active" : ""
                    }`}
                    onClick={() => handleThemeChange("system")}
                    title="跟随系统"
                    aria-label="跟随系统"
                  >
                    <IconMonitor size={15} />
                    <span>跟随系统</span>
                  </button>
                  <button
                    type="button"
                    className={`theme-segment-btn ${
                      settings.theme === "light" ? "active" : ""
                    }`}
                    onClick={() => handleThemeChange("light")}
                    title="浅色"
                    aria-label="浅色"
                  >
                    <IconSun size={15} />
                    <span>浅色</span>
                  </button>
                  <button
                    type="button"
                    className={`theme-segment-btn ${
                      settings.theme === "dark" ? "active" : ""
                    }`}
                    onClick={() => handleThemeChange("dark")}
                    title="深色"
                    aria-label="深色"
                  >
                    <IconMoon size={15} />
                    <span>深色</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 4: Models & Usage ── */}
        {activeTab === "models" && (
          <div className="settings-section-container">
            {/* Section 1: Plan */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">订阅方案</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">当前订阅方案：Google AI Pro</div>
                    <div className="settings-official-desc">
                      您可以升级至 Google AI Ultra 方案以获取更高的速率限制与并发额度。
                    </div>
                  </div>
                  <button
                    className="btn-google-upgrade"
                    onClick={() => flashSaved()}
                  >
                    升级方案
                  </button>
                </div>
              </div>
            </div>

            {/* Section 2: Model Credits */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">AI 模型积分</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">启用 AI 积分超额扣算</div>
                    <div className="settings-official-desc">
                      开启后，当模型用量额度耗尽时，Antigravity 将使用您的 AI 积分继续履行请求。系统始终优先扣除常规配额。
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      defaultChecked={false}
                      onChange={() => flashSaved()}
                      aria-label="启用 AI 积分超额扣算"
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </div>

            {/* Section 3: Gemini Models */}
            <div className="settings-card-group">
              <div className="settings-card-group-title section-header-row">
                <div className="section-header-title-wrap">
                  <span className="section-header-title">Gemini 系列模型配额</span>
                  <IconInfo size={13} className="info-icon" />
                </div>
                <button
                  type="button"
                  onClick={handleRefreshQuota}
                  className="btn-section-refresh"
                  title="重新同步最新额度"
                >
                  <IconRefresh size={11} className={quotaRefreshing ? "icon-spin" : ""} />
                  <span>刷新额度</span>
                </button>
              </div>
              <div className="settings-official-card">
                {/* Row 1: Weekly Limit */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">每周剩余额度</div>
                    <div className="settings-official-desc">
                      {quotaData.geminiWeeklyPct >= 100
                        ? "您尚未动用每周额度，将在 7 天后完整重置。"
                        : `您已使用部分每周额度（剩余 ${quotaData.geminiWeeklyPct}%），将在 6 天 23 小时后重置刷新。`}
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">{quotaData.geminiWeeklyPct}%</span>
                    <svg width="26" height="26" viewBox="0 0 24 24" className="quota-ring-svg">
                      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
                      <circle
                        cx="12"
                        cy="12"
                        r="9.5"
                        fill="none"
                        stroke={quotaData.geminiWeeklyPct > 30 ? "#4CAF50" : "#FFA000"}
                        strokeWidth="2.5"
                        strokeDasharray={59.69}
                        strokeDashoffset={59.69 * (1 - quotaData.geminiWeeklyPct / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                  </div>
                </div>

                {/* Row 2: Five Hour Limit */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">5小时动态剩余额度</div>
                    <div className="settings-official-desc">
                      {quotaData.gemini5hPct >= 100
                        ? "您尚未动用 5 小时额度，将在 5 小时后刷新。"
                        : `您已使用部分 5 小时额度（剩余 ${quotaData.gemini5hPct}%），将在 4 小时 37 分钟后刷新。`}
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">{quotaData.gemini5hPct}%</span>
                    <svg width="26" height="26" viewBox="0 0 24 24" className="quota-ring-svg">
                      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
                      <circle
                        cx="12"
                        cy="12"
                        r="9.5"
                        fill="none"
                        stroke={quotaData.gemini5hPct > 30 ? "#4CAF50" : "#FFA000"}
                        strokeWidth="2.5"
                        strokeDasharray={59.69}
                        strokeDashoffset={59.69 * (1 - quotaData.gemini5hPct / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4: Claude and GPT models */}
            <div className="settings-card-group">
              <div className="settings-card-group-title header-with-icon">
                <span>Claude 与 GPT 系列模型配额</span>
                <IconInfo size={13} className="info-icon" />
              </div>
              <div className="settings-official-card">
                {/* Row 1: Weekly Limit */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">每周剩余额度</div>
                    <div className="settings-official-desc">
                      {quotaData.claudeWeeklyPct >= 100
                        ? "您尚未动用每周额度，将在 7 天后完整重置。"
                        : `您已使用部分每周额度（剩余 ${quotaData.claudeWeeklyPct}%），将在 6 天 23 小时后重置刷新。`}
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">{quotaData.claudeWeeklyPct}%</span>
                    <svg width="26" height="26" viewBox="0 0 24 24" className="quota-ring-svg">
                      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
                      <circle
                        cx="12"
                        cy="12"
                        r="9.5"
                        fill="none"
                        stroke="#4CAF50"
                        strokeWidth="2.5"
                        strokeDasharray={59.69}
                        strokeDashoffset={59.69 * (1 - quotaData.claudeWeeklyPct / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                  </div>
                </div>

                {/* Row 2: Five Hour Limit */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">5小时动态剩余额度</div>
                    <div className="settings-official-desc">
                      {quotaData.claude5hPct >= 100
                        ? "您尚未动用 5 小时额度，将在 5 小时后刷新。"
                        : `您已使用部分 5 小时额度（剩余 ${quotaData.claude5hPct}%），将在 4 小时 37 分钟后刷新。`}
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">{quotaData.claude5hPct}%</span>
                    <svg width="26" height="26" viewBox="0 0 24 24" className="quota-ring-svg">
                      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
                      <circle
                        cx="12"
                        cy="12"
                        r="9.5"
                        fill="none"
                        stroke="#4CAF50"
                        strokeWidth="2.5"
                        strokeDasharray={59.69}
                        strokeDashoffset={59.69 * (1 - quotaData.claude5hPct / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 5: Default Model Preference */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">默认模型偏好</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">首选模型选择</div>
                    <div className="settings-official-desc">
                      新建对话会话时将自动优先绑定此模型
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.defaultModel ?? "__none__"}
                    onChange={(e) => handleModelChange(e.target.value)}
                  >
                    <option value="__none__">自动智能推荐 (最新 3.6 Flash / 3.1 Pro)</option>
                    {parsedModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 5: Customizations & Skills ── */}
        {activeTab === "customizations" && (
          <div className="settings-section-container">
            {/* 1. Superpowers Skills */}
            <div className="settings-card-group">
              <div className="settings-card-group-title section-header-row">
                <span className="section-header-title">超级技能库 (Superpowers)</span>
                <button
                  type="button"
                  onClick={fetchHealth}
                  className="btn-section-refresh"
                >
                  <IconRefresh size={11} />
                  <span>刷新技能状态</span>
                </button>
              </div>
              <div className="customizations-list">
                {skillsToDisplay.map((s) => {
                  const isEnabled = !disabledSkills.has(s.name);
                  const isProxyOnline = Boolean(healthData?.status === "ok");
                  const isLsOnline = Boolean(
                    healthData?.languageServers && healthData.languageServers.length > 0,
                  );
                  const isRealActive = isLsOnline && isEnabled;

                  const statusLabel = !isProxyOnline
                    ? "○ 代理未连通"
                    : !isLsOnline
                      ? "○ 软件未连接"
                      : !isEnabled
                        ? "○ 已手动禁用"
                        : "● 已激活";

                  return (
                    <div key={s.name} className="customization-card-row" style={{ opacity: isRealActive ? 1 : 0.6 }}>
                      <div className="customization-card-left">
                        <div className="customization-card-title">
                          <IconPuzzle size={14} className="puzzle-icon" />
                          <span className="skill-title-name">{s.label}</span>
                          {"tag" in s && <span className="skill-tag">{(s as { tag?: string }).tag}</span>}
                        </div>
                        <div className="customization-card-desc">
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginRight: 4 }}>{s.name}</span>
                          {s.desc}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`customization-status-badge ${isRealActive ? "" : "disabled"}`}>
                          {statusLabel}
                        </span>
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

            {/* 2. MCP Server Tools */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">MCP 服务与工具 (Model Context Protocol)</div>
              <div className="customizations-list">
                {mcpToDisplay.map((m) => {
                  const isEnabled = !disabledMcpTools.has(m.name);
                  const isProxyOnline = Boolean(healthData?.status === "ok");
                  const isLsOnline = Boolean(
                    healthData?.languageServers && healthData.languageServers.length > 0,
                  );
                  const isRealConnected = isLsOnline && isEnabled;

                  const statusLabel = !isProxyOnline
                    ? "○ 代理未连通"
                    : !isLsOnline
                      ? "○ 软件未连接"
                      : !isEnabled
                        ? "○ 已手动断开"
                        : "● 已连接";

                  return (
                    <div key={m.name} className="customization-card-row" style={{ opacity: isRealConnected ? 1 : 0.6 }}>
                      <div className="customization-card-left">
                        <div className="customization-card-title">
                          <span className="mcp-name-text">{m.name}</span>
                          <span className="mcp-tag">MCP 工具</span>
                        </div>
                        <div className="customization-card-desc">{m.desc}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`customization-status-badge mcp ${isRealConnected ? "" : "disabled"}`}>
                          {statusLabel}
                        </span>
                        <label className="settings-switch">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleMcpTool(m.name)}
                            aria-label={`开关 ${m.name}`}
                          />
                          <span className="settings-slider" />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Slash Commands */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">快捷斜杠指令集 (Slash Commands)</div>
              <div className="customizations-grid">
                {[
                  { cmd: "/goal", desc: "通宵超长任务自治推进，达成目标前绝不终止" },
                  { cmd: "/schedule", desc: "设置单次定时通知或 Cron 循环作业调度" },
                  { cmd: "/browser", desc: "自动化网页交互、DOM 检查与网络在线搜索" },
                  { cmd: "/grill-me", desc: "交互式需求细化对齐，消解方案设计歧义" },
                  { cmd: "/teamwork-preview", desc: "多智能体协同开发与团队协作效果预览" },
                  { cmd: "/learn", desc: "沉淀智能体修正经验与行为模式长效记忆" },
                ].map((c) => (
                  <div key={c.cmd} className="slash-card-item">
                    <span className="slash-card-cmd">{c.cmd}</span>
                    <span className="slash-card-desc">{c.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 6: Browser ── */}
        {activeTab === "browser" && (
          <div className="settings-section-container">
            <div className="settings-card-group">
              <div className="settings-card-group-title">Chrome DevTools MCP 自动化引擎</div>
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

        {/* ── Tab 7: App ── */}
        {activeTab === "app" && (
          <div className="settings-section-container">
            {/* Version & Build Info */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">应用与版本信息</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">Porta Web 客户端版本</div>
                    <div className="settings-official-desc">
                      专为 Google Antigravity & Codex 打造的渐进式 Web 应用 (PWA)
                    </div>
                  </div>
                  <div className="settings-card-badge-val">v1.2.0 (最新版)</div>
                </div>

                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">运行时环境</div>
                    <div className="settings-official-desc">
                      React 19 · TypeScript · Vite PWA · Workbox 离线内核
                    </div>
                  </div>
                  <span className="settings-status-online">● 正式生产环境</span>
                </div>
              </div>
            </div>

            {/* Offline & Cache Management */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">离线缓存与存储</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">Service Worker 离线缓存与存储</div>
                    <div className="settings-official-desc">
                      已缓存离线静态资源与对话数据（本地 LocalStorage 已用 {
                        (() => {
                          try {
                            let total = 0;
                            for (let i = 0; i < localStorage.length; i++) {
                              const key = localStorage.key(i);
                              if (key) {
                                total += (localStorage.getItem(key) ?? "").length + key.length;
                              }
                            }
                            return (total / 1024).toFixed(1);
                          } catch {
                            return "0.0";
                          }
                        })()
                      } KB）
                    </div>
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

                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">自动检测更新</div>
                    <div className="settings-official-desc">
                      新版本发布时自动接收并应用更新
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      defaultChecked
                      onChange={() => flashSaved()}
                      aria-label="自动检测更新"
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </div>

            {/* Data & Privacy */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">数据与本地存储</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">本地草稿与偏好设置</div>
                    <div className="settings-official-desc">
                      存储在浏览器 localStorage 中的草稿与参数设置
                    </div>
                  </div>
                  <button
                    className="btn-google-signout"
                    onClick={() => {
                      localStorage.removeItem("antigravity_drafts");
                      flashSaved();
                    }}
                  >
                    重置草稿
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 8: App Status ── */}
        {activeTab === "status" && (
          <div className="settings-section-container">
            <div className="settings-card-group">
              <div className="settings-card-group-title">Antigravity 服务端节点</div>
              <div className="settings-official-card">
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">语言服务代理</div>
                    <div className="settings-official-desc">
                      连接本地语言服务的 WebSocket 与 REST 代理通信桥
                    </div>
                  </div>
                  <span className="settings-status-online">● 连接正常 (200 OK)</span>
                </div>

                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">已监控工作区总数</div>
                    <div className="settings-official-desc">
                      语言服务当前实时监控的项目工作区数量
                    </div>
                  </div>
                  <div className="settings-card-badge-val">{workspaces.length} 个工作区</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Shortcuts Modal ── */}
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

      {/* ── Feedback Modal ── */}
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
                  <button className="btn-pill-primary" onClick={handleSendFeedback}>
                    提交反馈
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    {showSetupWizardLocal && createPortal(
      <SetupWizard onClose={() => {
        setShowSetupWizardLocal(false);
        setCustomServerUrl(getApiBase());
      }} />,
      document.body,
    )}
    </>
  );
}
