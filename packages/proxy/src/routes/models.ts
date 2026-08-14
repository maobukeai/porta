/**
 * /api/models route
 */

import type { Hono } from "hono";
import { rpcAny } from "../routing.js";

export const MODEL_MAP: Record<string, string> = {
  // Gemini 3.6 Flash
  "gemini-3.6-flash-high": "MODEL_PLACEHOLDER_M71",
  "gemini-3.6-flash-medium": "MODEL_PLACEHOLDER_M72",
  "gemini-3.6-flash-low": "MODEL_PLACEHOLDER_M73",

  // Gemini 3.5 Flash
  "gemini-3.5-flash-high": "MODEL_PLACEHOLDER_M132",
  "gemini-3-flash-agent": "MODEL_PLACEHOLDER_M132",
  "gemini-3.5-flash-medium": "MODEL_PLACEHOLDER_M20",
  "gemini-3.5-flash-low": "MODEL_PLACEHOLDER_M20",
  "gemini-3.5-flash-extra-low": "MODEL_PLACEHOLDER_M187",

  // Gemini 3.1 Pro
  "gemini-3.1-pro-high": "MODEL_PLACEHOLDER_M16",
  "gemini-pro-agent": "MODEL_PLACEHOLDER_M16",
  "gemini-3.1-pro-low": "MODEL_PLACEHOLDER_M36",

  // Claude
  "claude-sonnet-4.6": "MODEL_PLACEHOLDER_M35",
  "claude-sonnet-4-6": "MODEL_PLACEHOLDER_M35",
  "claude-opus-4.6": "MODEL_PLACEHOLDER_M26",
  "claude-opus-4-6-thinking": "MODEL_PLACEHOLDER_M26",

  // GPT-OSS
  "gpt-oss-120b": "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
  "gpt-oss-120b-medium": "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
};

const DEFAULT_MODEL_CONFIGS = [
  {
    label: "Gemini 3.6 Flash (Low)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M73" },
    modelId: "gemini-3.6-flash-low",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.95 },
  },
  {
    label: "Gemini 3.6 Flash (Medium)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M72" },
    modelId: "gemini-3.6-flash-medium",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.9 },
  },
  {
    label: "Gemini 3.6 Flash (High)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M71" },
    modelId: "gemini-3.6-flash-high",
    supportsImages: true,
    isRecommended: true,
    quotaInfo: { remainingFraction: 0.87 },
  },
  {
    label: "Gemini 3.5 Flash (Medium)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M20" },
    modelId: "gemini-3.5-flash-low",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.8 },
  },
  {
    label: "Gemini 3.1 Pro (Low)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M36" },
    modelId: "gemini-3.1-pro-low",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 0.7 },
  },
  {
    label: "Claude Sonnet 4.6 (Thinking)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M35" },
    modelId: "claude-sonnet-4-6",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
  {
    label: "Claude Opus 4.6 (Thinking)",
    modelOrAlias: { model: "MODEL_PLACEHOLDER_M26" },
    modelId: "claude-opus-4-6-thinking",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
  {
    label: "GPT-OSS 120B (Medium)",
    modelOrAlias: { model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM" },
    modelId: "gpt-oss-120b-medium",
    supportsImages: true,
    isRecommended: false,
    quotaInfo: { remainingFraction: 1.0 },
  },
];

export async function resolveModelIdentifier(modelInput?: string | null): Promise<string> {
  if (!modelInput) return "MODEL_PLACEHOLDER_M71";

  // If it's already a valid MODEL_... identifier, return it as-is
  if (modelInput.startsWith("MODEL_")) return modelInput;

  // Check static lookup table first
  const normalizedKey = modelInput.toLowerCase().trim();
  if (MODEL_MAP[normalizedKey]) {
    return MODEL_MAP[normalizedKey];
  }

  // Try querying dynamic model configs from LS
  try {
    const data = (await rpcAny("GetCascadeModelConfigData")) as {
      clientModelConfigs?: Array<{
        label?: string;
        modelId?: string;
        modelOrAlias?: { model?: string };
      }>;
      defaultOverrideModelConfig?: { modelOrAlias?: { model?: string } };
    };

    if (data?.clientModelConfigs) {
      for (const config of data.clientModelConfigs) {
        const targetModel = config.modelOrAlias?.model;
        if (!targetModel) continue;

        if (
          config.modelId?.toLowerCase() === normalizedKey ||
          config.label?.toLowerCase() === normalizedKey ||
          config.modelOrAlias?.model?.toLowerCase() === normalizedKey
        ) {
          return targetModel;
        }
      }
    }

    if (data?.defaultOverrideModelConfig?.modelOrAlias?.model) {
      return data.defaultOverrideModelConfig.modelOrAlias.model;
    }
  } catch {
    // Fall back below
  }

  return "MODEL_PLACEHOLDER_M71";
}

export function registerModelRoutes(app: Hono): void {
  app.get("/api/models", async (c) => {
    try {
      const data = (await rpcAny("GetCascadeModelConfigData")) as Record<string, unknown>;
      if (data && Array.isArray(data.clientModelConfigs) && data.clientModelConfigs.length > 0) {
        return c.json(data);
      }
      return c.json({
        clientModelConfigs: DEFAULT_MODEL_CONFIGS,
        defaultOverrideModelConfig: { modelOrAlias: { model: "MODEL_PLACEHOLDER_M71" } },
      });
    } catch {
      return c.json({
        clientModelConfigs: DEFAULT_MODEL_CONFIGS,
        defaultOverrideModelConfig: { modelOrAlias: { model: "MODEL_PLACEHOLDER_M71" } },
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
