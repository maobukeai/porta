export interface QuotaErrorDetail {
  isQuotaError: boolean;
  title: string;
  refreshTime?: string;
  detail: string;
  suggestion: string;
  rawError?: string;
  errorType: "baseline_quota" | "rate_limit" | "stream_disconnect" | "service_offline" | "generic";
}

export interface CleanErrorResult {
  summary: string;
  fullLog?: string;
}

/** Recursively unpack and sanitize raw error messages from JSON / Error objects / Go stack traces */
export function cleanErrorMessage(input: unknown): CleanErrorResult {
  if (!input) {
    return { summary: "请求遇到异常，未能成功连接或接收响应。" };
  }

  let raw = "";
  let fullLog: string | undefined;

  if (typeof input === "string") {
    raw = input.trim();
    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        return cleanErrorMessage(parsed);
      } catch {
        // Fallback to raw string
      }
    }
  } else if (input instanceof Error) {
    raw = input.message;
    fullLog = input.stack || input.message;
  } else if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    const nested = (obj.error && typeof obj.error === "object" ? obj.error : obj) as Record<string, unknown>;

    const candidate =
      nested.userErrorMessage ||
      nested.shortError ||
      nested.errorMessage ||
      nested.message ||
      nested.details ||
      nested.description ||
      nested.modelErrorMessage;

    if (candidate && typeof candidate === "string") {
      raw = candidate;
      fullLog = JSON.stringify(input, null, 2);
    } else {
      raw = JSON.stringify(input);
      fullLog = raw;
    }
  } else {
    raw = String(input);
  }

  if (raw === "[object Object]" || !raw) {
    raw = "请求遇到异常，未能成功连接或接收响应。";
  }

  // Detect and strip internal Go stack traces from user-facing summary
  const stackMarker = raw.search(
    /\n\s*(?:wraps:\s*\(\d+\)\s*attached stack trace|-- stack trace:|\(1\)\s*model output error|google3\/)/i,
  );
  if (stackMarker !== -1) {
    if (!fullLog) fullLog = raw;
    raw = raw.slice(0, stackMarker).trim();
  }

  // Remove repetitive debug prefixes
  raw = raw
    .replace(/^Error Message:\s*/i, "")
    .replace(/^model output error:\s*/i, "")
    .trim();

  // If raw is still very long (> 160 chars), preserve the original text in fullLog
  if (!fullLog && raw.length > 160) {
    fullLog = raw;
  }

  return {
    summary: raw || "执行遇到异常",
    fullLog: fullLog && fullLog !== raw ? fullLog : undefined,
  };
}

/** Parse various date/time formats extracted from error strings into Unix millisecond timestamp */
export function parseRefreshTimestamp(refreshTime?: string): number | null {
  if (!refreshTime) return null;
  const trimmed = refreshTime.trim();
  let ts = Date.parse(trimmed);
  if (!isNaN(ts) && ts > 0) return ts;

  const normalized = trimmed.replace(/\//g, "-").replace(" ", "T");
  ts = Date.parse(normalized);
  if (!isNaN(ts) && ts > 0) return ts;

  return null;
}

/** Parse and translate English quota / rate limit / API errors into rich Chinese cards */
export function parseQuotaError(errorInput?: unknown): QuotaErrorDetail {
  const { summary, fullLog } = cleanErrorMessage(errorInput);
  const raw = summary;
  const lower = raw.toLowerCase();

  // 1. Baseline model quota reached / Quota limit reached
  if (
    lower.includes("baseline model quota reached") ||
    lower.includes("quota reached") ||
    lower.includes("quota will refresh") ||
    lower.includes("exceeded quota") ||
    lower.includes("quota exceeded")
  ) {
    // Extract refresh time string if present (e.g. 2026/8/14 17:57:47 or 2026-08-14T17:57:47)
    const timeMatch =
      raw.match(/refresh (?:on|at) ([\d/:\-\sT]+(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)/i) ||
      raw.match(/(\d{4}[/:\-]\d{1,2}[/:\-]\d{1,2}(?:\s+|T)\d{1,2}:\d{2}(?::\d{2})?)/);
    const refreshTime = timeMatch ? timeMatch[1].trim().replace(/\.$/, "") : undefined;

    return {
      isQuotaError: true,
      title: "基准模型配额已达上限",
      refreshTime,
      detail: refreshTime
        ? `您的方案基础配额将于 ${refreshTime} 刷新重置。您可以升级至 Google AI Ultra 方案以获取更高的速率限制。`
        : "当前方案基础配额已耗尽，请等待系统自动刷新重置，或切换其他可用模型。",
      suggestion: "可点击下方“查看方案”查看实时模型额度，或直接切换模型继续对话。",
      rawError: fullLog || raw,
      errorType: "baseline_quota",
    };
  }

  // 2. Rate limit exceeded / 429 / Resource exhausted
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("too many requests")
  ) {
    return {
      isQuotaError: true,
      title: "请求发送频率超限 (429)",
      detail:
        raw && !raw.startsWith("API 429") && !raw.startsWith("429")
          ? raw
          : "当前模型调用频率过高，已触发系统的请求速率保护。请稍候再试，或切换至更轻量模型。",
      suggestion: "建议：请稍等 1~2 分钟后再试，或在输入框左侧切换至 Flash / Lite 模型。",
      rawError: fullLog || raw,
      errorType: "rate_limit",
    };
  }

  // 3. Network SSE stream disconnect / Remote closed / Proxy error
  if (
    lower.includes("streamgeneratecontent") ||
    lower.includes("forcibly closed") ||
    lower.includes("wsasend") ||
    lower.includes("write tcp")
  ) {
    return {
      isQuotaError: true,
      title: "模型响应流异常中断",
      detail:
        raw.includes("forcibly closed") || raw.includes("wsasend")
          ? "与模型服务器的连接中断（Remote host forcibly closed connection）。可能是代理连接不稳定或网络波动引起。"
          : raw,
      suggestion: "建议：请尝试切换响应模型重试，或检查网络连接与代理状态。",
      rawError: fullLog || raw,
      errorType: "stream_disconnect",
    };
  }

  // 4. Language Server / Workspace error
  if (lower.includes("no language server found") || lower.includes("503")) {
    return {
      isQuotaError: false,
      title: "后台服务未就绪",
      detail: raw,
      suggestion: "建议：请确认在 Antigravity 客户端中已打开当前项目文件夹。",
      rawError: fullLog || raw,
      errorType: "service_offline",
    };
  }

  // 5. Default general error
  return {
    isQuotaError: false,
    title: "❌ 执行中断或发送失败",
    detail: raw,
    suggestion: "请尝试重新发送消息或刷新页面。",
    rawError: fullLog || raw,
    errorType: "generic",
  };
}
