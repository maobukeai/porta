import { describe, it, expect } from "vitest";
import { parseQuotaError, cleanErrorMessage, parseRefreshTimestamp } from "../utils/quotaError";

describe("parseQuotaError", () => {
  it("parses baseline model quota reached error and extracts refresh timestamp", () => {
    const errorText =
      "Baseline model quota reached. Your plan's baseline quota will refresh on 2026/8/14 17:57:47. You can upgrade to a Google AI Ultra plan to receive higher rate limits. See plans.";

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.errorType).toBe("baseline_quota");
    expect(result.title).toBe("基准模型配额已达上限");
    expect(result.refreshTime).toBe("2026/8/14 17:57:47");
    expect(result.detail).toContain("2026/8/14 17:57:47");
    expect(result.detail).toContain("Google AI Ultra");
  });

  it("parses SSE connection closed / wsasend error gracefully", () => {
    const errorText =
      'Error: request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": write tcp 127.0.0.1:56058->127.0.0.1:7890: wsasend: An existing connection was forcibly closed by the remote host.';

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.errorType).toBe("stream_disconnect");
    expect(result.title).toBe("模型响应流异常中断");
    expect(result.detail).toContain("与模型服务器的连接中断");
    expect(result.suggestion).toContain("切换响应模型重试");
  });

  it("parses 429 rate limit exceeded", () => {
    const errorText = "API 429: Rate limit exceeded for model gemini-1.5-pro";

    const result = parseQuotaError(errorText);

    expect(result.isQuotaError).toBe(true);
    expect(result.errorType).toBe("rate_limit");
    expect(result.title).toContain("请求发送频率超限");
    expect(result.suggestion).toContain("Flash");
  });

  it("handles empty or generic errors safely", () => {
    const emptyResult = parseQuotaError("");
    expect(emptyResult.isQuotaError).toBe(false);

    const genericResult = parseQuotaError("Something went wrong");
    expect(genericResult.isQuotaError).toBe(false);
    expect(genericResult.title).toContain("执行中断或发送失败");
  });

  it("cleans raw Go stack traces and complex JSON payloads into clean human-readable summaries", () => {
    const payload = JSON.stringify({
      error: {
        userErrorMessage: "The model produced an invalid tool call.",
        modelErrorMessage: "There was a problem parsing the tool call. \nError Message: model output error: invalid tool call error\nwraps: (2) attached stack trace\ngoogle3/tools...",
      },
    });

    const cleaned = cleanErrorMessage(payload);
    expect(cleaned.summary).toBe("The model produced an invalid tool call.");
    expect(cleaned.fullLog).toBeDefined();
  });

  it("parseRefreshTimestamp parses different date time string formats accurately", () => {
    const ts1 = parseRefreshTimestamp("2026/8/14 17:57:47");
    expect(ts1).toBeGreaterThan(0);

    const ts2 = parseRefreshTimestamp("2026-08-14T19:00:00Z");
    expect(ts2).toBe(new Date("2026-08-14T19:00:00Z").getTime());

    const ts3 = parseRefreshTimestamp("invalid date format");
    expect(ts3).toBeNull();

    const ts4 = parseRefreshTimestamp(undefined);
    expect(ts4).toBeNull();
  });
});
