import { describe, it, expect } from "vitest";
import { resolveModelIdentifier, MODEL_MAP } from "../routes/models.js";

describe("models route & resolver", () => {
  it("includes Gemini 3.7 models in MODEL_MAP", () => {
    expect(MODEL_MAP["gemini-3.7-flash-high"]).toBe("MODEL_PLACEHOLDER_M298");
    expect(MODEL_MAP["gemini-3.7-flash-medium"]).toBe("MODEL_PLACEHOLDER_M299");
    expect(MODEL_MAP["gemini-3.7-flash-low"]).toBe("MODEL_PLACEHOLDER_M300");
  });

  it("resolves Gemini 3.7 model identifiers correctly", async () => {
    expect(await resolveModelIdentifier("gemini-3.7-flash-high")).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier("gemini-3.7-flash-medium")).toBe("MODEL_PLACEHOLDER_M299");
    expect(await resolveModelIdentifier("gemini-3.7-flash-low")).toBe("MODEL_PLACEHOLDER_M300");
  }, 15000);

  it("returns default M298 for null or unknown inputs when LS is unreachable", async () => {
    expect(await resolveModelIdentifier(null)).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier(undefined)).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier("unknown-model-xyz")).toBe("MODEL_PLACEHOLDER_M298");
  }, 15000);

  it("passes through MODEL_ placeholder strings directly", async () => {
    expect(await resolveModelIdentifier("MODEL_PLACEHOLDER_M298")).toBe("MODEL_PLACEHOLDER_M298");
    expect(await resolveModelIdentifier("MODEL_CUSTOM_123")).toBe("MODEL_CUSTOM_123");
  }, 15000);
});
