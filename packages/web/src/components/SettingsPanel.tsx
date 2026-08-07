/**
 * Settings panel — global client configuration.
 *
 * Currently supports:
 *   - Default model selection
 *   - Default planner type (Fast / Plan)
 *
 * Settings are stored client-side in localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import { IconChevronLeft, IconCheck } from "./Icons";
import { api } from "../api/client";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
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

interface Props {
  settings: ClientSettings;
  onUpdate: (patch: Partial<ClientSettings>) => void;
  onBack: () => void;
}

export function SettingsPanel({ settings, onUpdate, onBack }: Props) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(
      getBrowserNotificationPermission,
    );

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
        setModels(data.clientModelConfigs ?? []);
        setFetchError(false);
        return;
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
    setFetchError(true);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    const syncPermission = () => {
      setNotificationPermission(getBrowserNotificationPermission());
    };

    window.addEventListener("focus", syncPermission);
    return () => window.removeEventListener("focus", syncPermission);
  }, []);

  useEffect(() => {
    if (
      settings.browserNotificationsEnabled &&
      notificationPermission !== "granted"
    ) {
      onUpdate({ browserNotificationsEnabled: false });
    }
  }, [notificationPermission, onUpdate, settings.browserNotificationsEnabled]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleModelChange = useCallback(
    (modelId: string) => {
      const value = modelId === "__none__" ? null : modelId;
      onUpdate({ defaultModel: value });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handlePlannerChange = useCallback(
    (value: string) => {
      onUpdate({ defaultPlannerType: value as PlannerType });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handleNotificationsChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        onUpdate({ browserNotificationsEnabled: false });
        flashSaved();
        return;
      }

      const permission = await requestBrowserNotificationPermission();
      setNotificationPermission(permission);
      onUpdate({ browserNotificationsEnabled: permission === "granted" });
      flashSaved();
    },
    [onUpdate, flashSaved],
  );

  const handleReset = useCallback(() => {
    onUpdate({
      defaultModel: null,
      defaultPlannerType: "conversational",
      browserNotificationsEnabled: false,
    });
    flashSaved();
  }, [onUpdate, flashSaved]);

  const notificationsChecked =
    settings.browserNotificationsEnabled &&
    notificationPermission === "granted";
  const notificationsDisabled = notificationPermission === "unsupported";
  const notificationStatus =
    notificationPermission === "unsupported"
      ? "不支持"
      : notificationPermission === "denied"
        ? "已禁用"
        : notificationsChecked
          ? "开启"
          : "关闭";

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button
          className="settings-back-btn"
          onClick={onBack}
          title="返回对话"
        >
          <IconChevronLeft size={18} />
        </button>
        <h1 className="settings-title">设置</h1>
        <span className={`settings-saved-badge ${savedFlash ? "visible" : ""}`}>
          <IconCheck size={12} /> 已保存
        </span>
      </div>

      <div className="settings-body">
        {/* ── Model ── */}
        <div className="settings-section">
          <h2 className="settings-section-title">模型</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">默认模型</span>
              <span className="settings-row-desc">
                在您没有为每条消息显式选择模型时所使用的默认模型。更改仅适用于新消息。
              </span>
            </div>
            <select
              className="settings-select"
              value={settings.defaultModel ?? "__none__"}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              <option value="__none__">服务器默认</option>
              {fetchError && (
                <option disabled>⚠ 无法加载模型</option>
              )}
              {models.map((m) => (
                <option key={m.modelOrAlias.model} value={m.modelOrAlias.model}>
                  {m.label}
                  {m.supportsImages ? " [视觉]" : ""}
                  {m.isRecommended ? " (推荐)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Planner ── */}
        <div className="settings-section">
          <h2 className="settings-section-title">规划器</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">默认模式</span>
              <span className="settings-row-desc">
                “快速” 模式提供直接的单步响应。“规划” 模式针对复杂任务使用多步结构化方法。
              </span>
            </div>
            <select
              className="settings-select"
              value={settings.defaultPlannerType}
              onChange={(e) => handlePlannerChange(e.target.value)}
            >
              <option value="conversational">快速</option>
              <option value="planning">规划</option>
            </select>
          </div>
        </div>

        {/* Notifications */}
        <div className="settings-section">
          <h2 className="settings-section-title">通知</h2>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">浏览器通知</span>
              <span className="settings-row-desc">
                在运行完成和需要审批请求时进行通知。
              </span>
            </div>
            <div className="settings-notification-control">
              <span className="settings-permission-status">
                {notificationStatus}
              </span>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={notificationsChecked}
                  disabled={notificationsDisabled}
                  onChange={(e) => {
                    void handleNotificationsChange(e.target.checked);
                  }}
                  aria-label="Browser Notifications"
                />
                <span className="settings-switch-track" />
              </label>
            </div>
          </div>
        </div>

        {/* ── Reset ── */}
        <button className="settings-reset-btn" onClick={handleReset}>
          将所有设置重置为默认值
        </button>
      </div>
    </div>
  );
}
