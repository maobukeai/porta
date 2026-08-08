import { describe, it, expect } from "vitest";
import { parseQuotaError } from "../utils/quotaError";

describe("parseQuotaError", () => {
  it("parses baseline model quota reached error and extracts refresh timestamp", () => {
    const errorText =
      "Baseline model quota reached. Your plan's baseline quota will refresh on 2026/8/8 16:37:14. You can upgrade to a Google AI Ultra plan to receive higher rate limits. See plans.";

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.title).toContain("基线模型额度已达上限");
    expect(result.refreshTime).toBe("2026/8/8 16:37:14");
    expect(result.detail).toContain("2026/8/8 16:37:14");
    expect(result.suggestion).toContain("切换其他模型");
  });

  it("parses SSE connection closed / wsasend error gracefully", () => {
    const errorText =
      'Error: request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": write tcp 127.0.0.1:56058->127.0.0.1:7890: wsasend: An existing connection was forcibly closed by the remote host.';

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.title).toContain("模型响应流异常中断");
    expect(result.detail).toContain("与模型服务器的连接中断");
    expect(result.suggestion).toContain("切换响应模型重试");
  });

  it("parses 429 rate limit exceeded", () => {
    const errorText = "API 429: Rate limit exceeded for model gemini-1.5-pro";

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.title).toContain("请求发送频率超限");
    expect(result.detail).toContain("触发了系统的限流保护");
  });

  it("handles empty or generic errors safely", () => {
    const emptyResult = parseQuotaError("");
    expect(emptyResult.isQuotaError).toBe(false);

    const genericResult = parseQuotaError("Something went wrong");
    expect(genericResult.isQuotaError).toBe(false);
    expect(genericResult.title).toContain("执行中断或发送失败");
  });
});
