export interface QuotaErrorDetail {
  isQuotaError: boolean;
  title: string;
  refreshTime?: string;
  detail: string;
  suggestion: string;
  rawError?: string;
}

/** Parse and translate English quota / rate limit / API errors into rich Chinese cards */
export function parseQuotaError(errorText?: string): QuotaErrorDetail {
  if (!errorText) {
    return {
      isQuotaError: false,
      title: "请求发生错误",
      detail: "未接收到具体的错误响应信息。",
      suggestion: "请重新发送消息或刷新页面试下。",
    };
  }

  const raw = errorText.trim();
  const lower = raw.toLowerCase();

  // 1. Baseline model quota reached
  if (
    lower.includes("baseline model quota reached") ||
    lower.includes("quota reached") ||
    lower.includes("quota will refresh") ||
    lower.includes("exceeded quota")
  ) {
    // Extract refresh time string if present (e.g. 2026/8/8 16:37:14 or 2026-08-08T16:37:14)
    const timeMatch =
      raw.match(/refresh (?:on|at) ([\d/:\-\sT]+)/i) ||
      raw.match(/(\d{4}[/:\-]\d{1,2}[/:\-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
    const refreshTime = timeMatch ? timeMatch[1].trim() : undefined;

    return {
      isQuotaError: true,
      title: "基线模型额度已达上限",
      refreshTime,
      detail: refreshTime
        ? `当前模型使用额度已耗尽，系统将在 ${refreshTime} 自动刷新重置。`
        : "当前模型使用额度已耗尽，请等待刷新配额重置。",
      suggestion:
        "建议：可尝试在输入框左侧切换其他模型（如 Flash / Lite）或升级账户方案。",
      rawError: raw,
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
      title: "请求发送频率超限",
      detail: "当前模型调用频率过高，触发了系统的限流保护。",
      suggestion:
        "建议：请稍等 1~2 分钟后再试，或在输入框左侧切换至 Flash 模型。",
      rawError: raw,
    };
  }

  // 3. Network SSE stream disconnect / Remote closed / Proxy error
  if (
    lower.includes("streamgeneratecontent") ||
    lower.includes("forcibly closed") ||
    lower.includes("wsasend") ||
    lower.includes("connection refused") ||
    lower.includes("write tcp")
  ) {
    return {
      isQuotaError: true,
      title: "模型响应流异常中断",
      detail:
        "与模型服务器的连接中断，可能由于额度配额到期、代理断开或会话关闭导致。",
      suggestion:
        "建议：请尝试切换响应模型重试，或检查网络与代理连接状态。",
      rawError: raw,
    };
  }

  // 4. Language Server / Workspace error
  if (lower.includes("no language server found") || lower.includes("503")) {
    return {
      isQuotaError: false,
      title: "后台服务未启动",
      detail: "未检测到该项目在桌面软件中的 Language Server 进程。",
      suggestion:
        "建议：请确认在 Antigravity 客户端中已打开当前项目文件夹。",
      rawError: raw,
    };
  }

  // 4. Default general error
  return {
    isQuotaError: false,
    title: "❌ 执行中断或发送失败",
    detail: raw.length > 150 ? `${raw.slice(0, 147)}...` : raw,
    suggestion: "请尝试重新发送消息或刷新页面。",
    rawError: raw,
  };
}
