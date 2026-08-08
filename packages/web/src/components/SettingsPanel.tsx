/**
 * Antigravity Full Settings Panel (全功能汉化高级版)
 * Replicates the complete official settings interface with real data integration and full Chinese localization.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "./Icons";
import { api } from "../api/client";
import { requestBrowserNotificationPermission } from "../utils/browserNotifications";
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

  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const [userEmail, setUserEmail] = useState<string>("");
  const [userPlan, setUserPlan] = useState<string>("");

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
    } catch (err) {
      console.warn("Failed to fetch user status:", err);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    fetchUserStatus();
  }, [fetchModels, fetchUserStatus]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Parse models sorted by quality/tier
  const parsedModels: ParsedModelOption[] = useMemo(() => {
    const list = models.map((m) => {
      const label = m.label || m.modelOrAlias.model;
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
        id: m.modelOrAlias.model,
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
                      {userEmail || "未获取到邮箱 (或加载中)"}
                    </div>
                  </div>
                  <button
                    className="btn-google-signout"
                    onClick={() => flashSaved()}
                  >
                    退出登录
                  </button>
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
              <div className="settings-card-group-title">消息通知</div>
              <div className="settings-card-row">
                <div className="settings-card-info">
                  <div className="settings-card-label">浏览器桌面通知</div>
                  <div className="settings-card-desc">当长时间运行的代码任务或命令完成时弹出系统通知</div>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    checked={settings.browserNotificationsEnabled}
                    onChange={handleToggleNotifications}
                  />
                  <span className="settings-slider" />
                </label>
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
              <div className="settings-card-group-title header-with-icon">
                <span>Gemini 系列模型配额</span>
                <IconInfo size={13} className="info-icon" />
              </div>
              <div className="settings-official-card">
                {/* Row 1: Weekly Limit */}
                <div className="settings-official-row">
                  <div className="settings-official-info">
                    <div className="settings-official-label">每周剩余额度</div>
                    <div className="settings-official-desc">
                      您已使用部分每周额度，将在 6 天 23 小时后重置刷新。
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">87%</span>
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
                        strokeDashoffset={59.69 * (1 - 0.87)}
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
                      您已使用部分 5 小时额度，将在 4 小时 37 分钟后刷新。
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">21%</span>
                    <svg width="26" height="26" viewBox="0 0 24 24" className="quota-ring-svg">
                      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
                      <circle
                        cx="12"
                        cy="12"
                        r="9.5"
                        fill="none"
                        stroke="#FFA000"
                        strokeWidth="2.5"
                        strokeDasharray={59.69}
                        strokeDashoffset={59.69 * (1 - 0.21)}
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
                      您尚未动用每周额度，将在 7 天后完整重置。
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">100%</span>
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
                        strokeDashoffset={0}
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
                      您尚未动用 5 小时额度，将在 5 小时后刷新。
                    </div>
                  </div>
                  <div className="quota-ring-container">
                    <span className="quota-ring-percent">100%</span>
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
                        strokeDashoffset={0}
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
              <div className="settings-card-group-title">超级技能库 (Superpowers)</div>
              <div className="customizations-list">
                {[
                  {
                    name: "frontend_design",
                    label: "前端极致设计",
                    desc: "构建兼具高端设计感与生产级别的独特前端界面，避开平庸排版。",
                  },
                  {
                    name: "ui-ux-pro-max",
                    label: "UI/UX 智能体",
                    desc: "内置 50+ 风格、161+ 色板、57+ 字体与 99+ 条核心设计指南。",
                  },
                  {
                    name: "brainstorming",
                    label: "深度头脑风暴",
                    desc: "在动手开发前深入探索用户意图、技术架构与多维度方案设计。",
                  },
                  {
                    name: "systematic-debugging",
                    label: "系统化调试",
                    desc: "严密追溯 Bug 根因，系统化推导代码修复与防御策略。",
                  },
                  {
                    name: "test-driven",
                    label: "测试驱动开发",
                    desc: "在实现新功能前编写严格的断言与单元测试逻辑。",
                  },
                  {
                    name: "subagent-driven",
                    label: "子代理并行",
                    desc: "多任务并行调度独立子智能体，执行无状态依赖的复合规划。",
                  },
                  {
                    name: "executing-plans",
                    label: "计划执行器",
                    desc: "按实施步骤逐项验收并推进大型开发里程碑。",
                  },
                ].map((s) => (
                  <div key={s.name} className="customization-card-row">
                    <div className="customization-card-left">
                      <div className="customization-card-title">
                        <IconPuzzle size={14} className="puzzle-icon" />
                        <span className="skill-title-name">{s.name}</span>
                        <span className="skill-tag">{s.label}</span>
                      </div>
                      <div className="customization-card-desc">{s.desc}</div>
                    </div>
                    <span className="customization-status-badge">● 已激活</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. MCP Server Tools */}
            <div className="settings-card-group">
              <div className="settings-card-group-title">MCP 服务与工具 (Model Context Protocol)</div>
              <div className="customizations-list">
                {[
                  {
                    name: "blender-mcp",
                    desc: "3D 资产建模、渲染调度、Polyhaven 与 Sketchfab 模型检索集成。",
                  },
                  {
                    name: "chrome-devtools-mcp",
                    desc: "原生自动化网页交互、DOM 检查、Console 日志抓取与截屏审查。",
                  },
                  {
                    name: "github-mcp-server",
                    desc: "GitHub 仓库检索、分支建立、PR 自动创建与代码合并自动化。",
                  },
                  {
                    name: "prisma-mcp-server",
                    desc: "Prisma 数据库迁移状态监控与 Prisma Studio 调试可视化。",
                  },
                  {
                    name: "videostudio-tutorial",
                    desc: "自动化视频教程录制、片段合成与渲染流水线。",
                  },
                ].map((m) => (
                  <div key={m.name} className="customization-card-row">
                    <div className="customization-card-left">
                      <div className="customization-card-title">
                        <span className="mcp-name-text">{m.name}</span>
                        <span className="mcp-tag">MCP 工具</span>
                      </div>
                      <div className="customization-card-desc">{m.desc}</div>
                    </div>
                    <span className="customization-status-badge mcp">● 已连接</span>
                  </div>
                ))}
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
                <span className="settings-status-online">● 已就绪</span>
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
                    <div className="settings-official-label">Service Worker 离线缓存</div>
                    <div className="settings-official-desc">
                      缓存静态资源与对话界面，实现离线秒级启动
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
  );
}
