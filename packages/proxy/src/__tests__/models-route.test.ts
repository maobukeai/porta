import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpcAny = vi.fn();
vi.mock("../routing.js", () => ({
  rpcAny: (...args: unknown[]) => mockRpcAny(...args),
}));

const { resolveModelIdentifier, MODEL_MAP } = await import("../routes/models.js");

describe("models route & resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcAny.mockRejectedValue(new Error("LS unreachable in unit test"));
  });

  it("includes Gemini 3.8 and Gemini 3.7 models in MODEL_MAP", () => {
    expect(MODEL_MAP["gemini-3.8-flash-high"]).toBe("MODEL_PLACEHOLDER_M318");
    expect(MODEL_MAP["gemini-3.8-flash-medium"]).toBe("MODEL_PLACEHOLDER_M319");
    expect(MODEL_MAP["gemini-3.8-flash-low"]).toBe("MODEL_PLACEHOLDER_M320");
    expect(MODEL_MAP["gemini-3.8-flash"]).toBe("MODEL_PLACEHOLDER_M318");
    expect(MODEL_MAP["gemini-3.8"]).toBe("MODEL_PLACEHOLDER_M318");
    expect(MODEL_MAP["gemini-3.7-flash-high"]).toBe("MODEL_PLACEHOLDER_M298");
    expect(MODEL_MAP["gemini-3.7-flash-medium"]).toBe("MODEL_PLACEHOLDER_M299");
    expect(MODEL_MAP["gemini-3.7-flash-low"]).toBe("MODEL_PLACEHOLDER_M300");
  });

  it("resolves Gemini 3.8 and 3.7 model identifiers correctly", async () => {
    expect(await resolveModelIdentifier("gemini-3.8-flash-high")).toBe("MODEL_PLACEHOLDER_M318");
    expect(await resolveModelIdentifier("gemini-3.8-flash-medium")).toBe("MODEL_PLACEHOLDER_M319");
    expect(await resolveModelIdentifier("gemini-3.8-flash-low")).toBe("MODEL_PLACEHOLDER_M320");
    expect(await resolveModelIdentifier("gemini-3.7-flash-high")).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier("gemini-3.7-flash-medium")).toBe("MODEL_PLACEHOLDER_M299");
    expect(await resolveModelIdentifier("gemini-3.7-flash-low")).toBe("MODEL_PLACEHOLDER_M300");
  });

  it("returns default M318 for null or unknown inputs when LS is unreachable", async () => {
    expect(await resolveModelIdentifier(null)).toBe("MODEL_PLACEHOLDER_M318");
    expect(await resolveModelIdentifier(undefined)).toBe("MODEL_PLACEHOLDER_M318");
    expect(await resolveModelIdentifier("unknown-model-xyz")).toBe("MODEL_PLACEHOLDER_M318");
  });

  it("uses dynamic model configs when LS is reachable", async () => {
    mockRpcAny.mockResolvedValue({
      clientModelConfigs: [
        {
          label: "Custom Dynamic Model",
          modelId: "custom-dynamic",
          modelOrAlias: { model: "MODEL_DYNAMIC_999" },
        },
      ],
      defaultOverrideModelConfig: {
        modelOrAlias: { model: "MODEL_DYNAMIC_OVERRIDE" },
      },
    });

    expect(await resolveModelIdentifier(null)).toBe("MODEL_DYNAMIC_OVERRIDE");
    expect(await resolveModelIdentifier("custom-dynamic")).toBe("MODEL_DYNAMIC_999");
  });

  it("passes through MODEL_ placeholder strings directly", async () => {
    expect(await resolveModelIdentifier("MODEL_PLACEHOLDER_M298")).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier("MODEL_PLACEHOLDER_M318")).toBe("MODEL_PLACEHOLDER_M318");
    expect(await resolveModelIdentifier("MODEL_CUSTOM_123")).toBe("MODEL_CUSTOM_123");
  });
});
