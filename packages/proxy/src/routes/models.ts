/**
 * /api/models route
 */

import type { Hono } from "hono";
import { rpcAny } from "../routing.js";

const DEFAULT_MODEL_CONFIGS = [
  {
    label: "Gemini 3.6 Flash (Low)",
    modelOrAlias: { model: "gemini-3.6-flash-low" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.95 },
  },
  {
    label: "Gemini 3.6 Flash (Medium)",
    modelOrAlias: { model: "gemini-3.6-flash-medium" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.9 },
  },
  {
    label: "Gemini 3.6 Flash (High)",
    modelOrAlias: { model: "gemini-3.6-flash-high" },
    supportsImages: true,
    isRecommended: true,
    quotaInfo: { remainingFraction: 0.87 },
  },
  {
    label: "Gemini 3.5 Flash (Medium)",
    modelOrAlias: { model: "gemini-3.5-flash-medium" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.8 },
  },
  {
    label: "Gemini 3.1 Pro (Low)",
    modelOrAlias: { model: "gemini-3.1-pro-low" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.7 },
  },
  {
    label: "Claude Sonnet 4.6 (Thinking)",
    modelOrAlias: { model: "claude-sonnet-4.6" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
  {
    label: "Claude Opus 4.6 (Thinking)",
    modelOrAlias: { model: "claude-opus-4.6" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
  {
    label: "GPT-OSS 120B (Medium)",
    modelOrAlias: { model: "gpt-oss-120b" },
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
];

export function registerModelRoutes(app: Hono): void {
  app.get("/api/models", async (c) => {
    try {
      const data = (await rpcAny("GetCascadeModelConfigData")) as Record<string, unknown>;
      if (data && Array.isArray(data.clientModelConfigs) && data.clientModelConfigs.length > 0) {
        return c.json(data);
      }
      return c.json({
        clientModelConfigs: DEFAULT_MODEL_CONFIGS,
        defaultOverrideModelConfig: { modelOrAlias: { model: "gemini-3.6-flash-high" } },
      });
    } catch {
      return c.json({
        clientModelConfigs: DEFAULT_MODEL_CONFIGS,
        defaultOverrideModelConfig: { modelOrAlias: { model: "gemini-3.6-flash-high" } },
      });
    }
  });

  app.get("/api/user-status", async (c) => {
    try {
      const data = await rpcAny("GetUserStatus");
      return c.json(data);
    } catch {
      return c.json({
        userStatus: {
          name: "Developer",
          planStatus: "Google AI Pro",
          userTier: { name: "Pro Tier", id: "pro" },
          cascadeModelConfigData: { clientModelConfigs: DEFAULT_MODEL_CONFIGS },
        },
      });
    }
  });
}
