let cachedApiBase: string | null = null;

export function getApiBase(): string {
  if (cachedApiBase !== null) return cachedApiBase;
  try {
    const custom = typeof localStorage !== "undefined" ? localStorage.getItem("porta_custom_api_base") : null;
    if (custom && custom.trim()) {
      cachedApiBase = custom.trim().replace(/\/+$/, "");
      return cachedApiBase;
    }
  } catch {}
  cachedApiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
  return cachedApiBase ?? "";
}

export function setCustomApiBase(url: string): void {
  if (!url || !url.trim()) {
    try {
      localStorage.removeItem("porta_custom_api_base");
    } catch {}
    cachedApiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
  } else {
    const normalized = url.trim().replace(/\/+$/, "");
    try {
      localStorage.setItem("porta_custom_api_base", normalized);
    } catch {}
    cachedApiBase = normalized;
  }
}

let cachedApiToken: string | null = null;

/**
 * Shared access token for proxies that enable PORTA_TOKEN auth.
 * Empty/unset means the proxy runs without auth (loopback setups).
 */
export function getApiToken(): string {
  if (cachedApiToken !== null) return cachedApiToken;
  try {
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem("porta_auth_token") : null;
    cachedApiToken = stored?.trim() ?? "";
  } catch {
    cachedApiToken = "";
  }
  return cachedApiToken;
}

export function setApiToken(token: string): void {
  const normalized = token.trim();
  cachedApiToken = normalized;
  try {
    if (normalized) {
      localStorage.setItem("porta_auth_token", normalized);
    } else {
      localStorage.removeItem("porta_auth_token");
    }
  } catch {}
}

export function authHeaders(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function resolveWsUrl(path: string): string {
  const apiBase = getApiBase();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  let url: string;
  if (apiBase) {
    if (apiBase.startsWith("https://")) {
      url = `${apiBase.replace(/^https:\/\//, "wss://")}${cleanPath}`;
    } else if (apiBase.startsWith("http://")) {
      url = `${apiBase.replace(/^http:\/\//, "ws://")}${cleanPath}`;
    } else {
      url = `ws://${apiBase}${cleanPath}`;
    }
  } else if (typeof window !== "undefined" && window.location?.host) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    url = `${protocol}//${window.location.host}${cleanPath}`;
  } else {
    url = `ws://localhost:3170${cleanPath}`;
  }

  const token = getApiToken();
  if (token) {
    // Browser WebSocket cannot set headers — pass the shared token as a query param.
    return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }
  return url;
}

function previewBody(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 120) return singleLine;
  return `${singleLine.slice(0, 117)}...`;
}

const gitStatusCache = new Map<string, { data: any; time: number }>();

export function clearGitStatusCache(): void {
  gitStatusCache.clear();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const baseUrl = getApiBase();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  } catch (err) {
    const isNative = Boolean(
      (window as any).Capacitor?.isNativePlatform?.() ||
        (window as any).Capacitor?.platform === "android",
    );
    if (!baseUrl && isNative) {
      throw new Error(
        "无法发送消息：安卓 APK 未配置服务器地址。请点击设置 (⚙) 填入电脑端代理 IP (如 http://192.168.1.100:3000)",
      );
    }
    if (baseUrl) {
      throw new Error(
        `无法连接代理服务 (${baseUrl})，请检查手机与电脑是否处于同一 WiFi/局域网`,
      );
    }
    throw new Error("网络连接断开，请检查代理服务与局域网连接");
  }

  if (!res.ok) {
    const body = await res.text();
    let msg = "";
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === "string") {
        msg = parsed;
      } else if (typeof parsed.error === "string") {
        msg = parsed.error;
      } else if (typeof parsed.error === "object" && parsed.error !== null) {
        msg = parsed.error.message || parsed.error.error || parsed.error.details || JSON.stringify(parsed.error);
      } else if (typeof parsed.message === "string") {
        msg = parsed.message;
      } else {
        msg = JSON.stringify(parsed);
      }
    } catch {
      msg = body;
    }
    throw new Error(msg ? `API ${res.status}: ${msg}` : `API ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    const body = previewBody(await res.text());
    throw new Error(
      `API returned non-JSON for ${path}: ${body || "<empty response>"}`,
    );
  }

  return res.json();
}

export const api = {
  health: () => request<import("../types").HealthResponse>("/api/health"),

  systemDiagnostics: () =>
    request<import("../types").SystemDiagnostics>("/api/system/diagnostics"),

  launchAntigravity: () =>
    request<import("../types").LaunchAntigravityResponse>(
      "/api/system/antigravity/launch",
      { method: "POST" },
    ),

  cockpitStatus: () =>
    request<import("../types").CockpitStatus>("/api/cockpit/status"),

  cockpitAccounts: () =>
    request<import("../types").CockpitAccountsResponse>("/api/cockpit/accounts"),

  cockpitSwitchAccount: (accountId: string) =>
    request<import("../types").CockpitSwitchResponse>(
      `/api/cockpit/accounts/${encodeURIComponent(accountId)}/switch`,
      { method: "POST" },
    ),

  cockpitRefreshQuota: (accountId: string) =>
    request<import("../types").CockpitRefreshQuotaResponse>(
      `/api/cockpit/accounts/${encodeURIComponent(accountId)}/refresh-quota`,
      { method: "POST" },
    ),

  conversations: () =>
    request<import("../types").ConversationsResponse>("/api/conversations"),

  getConversation: (cascadeId: string) =>
    request<import("../types").ConversationDetail>(
      `/api/conversations/${cascadeId}`,
    ),

  /** Fetch steps with optional limit. Returns { steps, offset, stepCount? }. */
  getSteps: (cascadeId: string, offset = 0, limit?: number, tail?: number) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (limit !== undefined) params.set("limit", String(limit));
    if (tail !== undefined) params.set("tail", String(tail));
    return request<import("../types").StepsPageResponse>(
      `/api/conversations/${cascadeId}/steps?${params}`,
    );
  },

  getWorkspaces: () =>
    request<{
      workspaceInfos?: { workspaceUri: string; gitRootUri?: string }[];
    }>("/api/workspaces"),

  startConversation: (
    workspaceUri?: string | null,
    fileAccessGranted = false,
    noWorkspace = false,
  ) =>
    request<{ cascadeId: string }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        ...(workspaceUri && !noWorkspace
          ? { workspaceFolderAbsoluteUri: workspaceUri }
          : {}),
        noWorkspace:
          noWorkspace ||
          workspaceUri === null ||
          (!workspaceUri && typeof workspaceUri !== "undefined"),
        fileAccessGranted,
      }),
    }),

  sendMessage: (
    cascadeId: string,
    items: unknown[],
    clientMessageId?: string,
    model?: string,
    media?: Array<{ mimeType: string; inlineData: string }>,
    plannerType?: string,
    fileAccessGranted = false,
    executionMode?: string,
  ) =>
    request(`/api/conversations/${cascadeId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        items,
        clientMessageId,
        model,
        media,
        plannerType,
        fileAccessGranted,
        executionMode,
      }),
    }),

  stop: (cascadeId: string) =>
    request(`/api/conversations/${cascadeId}/stop`, { method: "POST" }),

  filePermission: (
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) =>
    request(`/api/conversations/${cascadeId}/file-permission`, {
      method: "POST",
      body: JSON.stringify({
        trajectoryId,
        stepIndex,
        allow,
        scope,
        absolutePathUri,
      }),
    }),

  commandAction: (
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) =>
    request(`/api/conversations/${cascadeId}/command-action`, {
      method: "POST",
      body: JSON.stringify({
        trajectoryId,
        stepIndex,
        approved,
      }),
    }),

  askQuestion: (
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    responses: import("../types").AskQuestionEntry[],
    cancelled = false,
  ) =>
    request(`/api/conversations/${cascadeId}/ask-question`, {
      method: "POST",
      body: JSON.stringify({
        trajectoryId,
        stepIndex,
        responses,
        cancelled,
      }),
    }),

  getRevertPreview: (cascadeId: string, stepIndex: number) =>
    request<{
      files: Array<{
        fileUri: string;
        fileName: string;
        ext: string;
        additions: number;
        deletions: number;
        isCreated?: boolean;
      }>;
    }>(`/api/conversations/${cascadeId}/revert-preview?stepIndex=${stepIndex}`),

  revert: (cascadeId: string, stepIndex: number, model?: string) =>
    request(`/api/conversations/${cascadeId}/revert`, {
      method: "POST",
      body: JSON.stringify({ stepIndex, model }),
    }),

  deleteConversation: (cascadeId: string) =>
    request(`/api/conversations/${cascadeId}`, { method: "DELETE" }),

  models: () =>
    request<{
      clientModelConfigs: Array<{
        label: string;
        modelOrAlias: { model: string };
        supportsImages: boolean;
        isRecommended: boolean;
        quotaInfo?: { remainingFraction: number; resetTime?: string };
      }>;
      defaultOverrideModelConfig?: { modelOrAlias: { model: string } };
    }>("/api/models"),

  userStatus: () =>
    request<{
      userStatus?: {
        name?: string;
        email?: string;
        planStatus?: string;
        userTier?: {
          id?: string;
          name?: string;
          description?: string;
        };
        cascadeModelConfigData?: {
          clientModelConfigs?: Array<{
            label: string;
            modelOrAlias: { model: string };
            supportsImages: boolean;
            isRecommended: boolean;
            quotaInfo?: {
              remainingFraction: number;
              resetTime?: string;
            };
          }>;
        };
        userQuotaSummary?: import("../types").UserQuotaSummary;
      };
      userQuotaSummary?: import("../types").UserQuotaSummary;
    }>("/api/user-status"),

  quota: () =>
    request<import("../types").UserQuotaSummary>("/api/quota"),

  rpc: (method: string, body: Record<string, unknown> = {}) =>
    request(`/api/rpc/${method}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  search: (query: string) =>
    request<{
      query: string;
      results: {
        id: string;
        title: string;
        snippets: string[];
        matchCount: number;
      }[];
      totalConversations: number;
      elapsedMs: number;
    }>(`/api/search?q=${encodeURIComponent(query)}`),

  commands: (workspaceUri?: string) =>
    request<{
      commands: Array<{
        name: string;
        desc: string;
        category?: "slash" | "skill" | "plugin" | "mcp";
      }>;
    }>(`/api/commands${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`),

  customizations: () =>
    request<{
      skills: Array<{ name: string; description: string; source: string }>;
      mcpServers: Array<{ name: string; description: string }>;
    }>("/api/customizations"),

  agentCapabilities: {
    memory: (workspaceUri?: string) =>
      request<import("../types").MemorySummaryResponse>(
        `/api/agent-capabilities/memory${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
      ),
    saveMemory: (path: string, content: string) =>
      request<{ success: boolean; path: string }>("/api/agent-capabilities/memory/save", {
        method: "POST",
        body: JSON.stringify({ path, content }),
      }),
    plugins: () =>
      request<{ plugins: import("../types").PluginInfo[]; total: number }>(
        "/api/agent-capabilities/plugins",
      ),
    togglePlugin: (pluginId: string, enabled: boolean) =>
      request<{ success: boolean; pluginId: string; enabled: boolean }>(
        "/api/agent-capabilities/plugins/toggle",
        {
          method: "POST",
          body: JSON.stringify({ pluginId, enabled }),
        },
      ),
    installPlugin: (pluginId: string) =>
      request<{ success: boolean; pluginId: string; message: string }>(
        "/api/agent-capabilities/plugins/install",
        {
          method: "POST",
          body: JSON.stringify({ pluginId }),
        },
      ),
    uninstallPlugin: (pluginId: string) =>
      request<{ success: boolean; pluginId: string; message: string }>(
        "/api/agent-capabilities/plugins/uninstall",
        {
          method: "POST",
          body: JSON.stringify({ pluginId }),
        },
      ),
    skills: () =>
      request<{ skills: import("../types").SkillDetailedInfo[]; total: number }>(
        "/api/agent-capabilities/skills",
      ),
    skillContent: (path: string) =>
      request<import("../types").SkillContentResponse>(
        `/api/agent-capabilities/skills/content?path=${encodeURIComponent(path)}`,
      ),
    subagents: () =>
      request<{ subagents: import("../types").SubagentInfo[]; total: number }>(
        "/api/agent-capabilities/subagents",
      ),
    createSubagent: (data: { name: string; role: string; description: string; tools?: string[]; systemPrompt: string }) =>
      request<{ success: boolean; path: string; name: string }>(
        "/api/agent-capabilities/subagents/create",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    updateSubagent: (data: { path: string; name: string; role: string; description: string; tools?: string[]; systemPrompt: string }) =>
      request<{ success: boolean; path: string }>(
        "/api/agent-capabilities/subagents/update",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    deleteSubagent: (path: string) =>
      request<{ success: boolean; path: string }>(
        "/api/agent-capabilities/subagents/delete",
        {
          method: "POST",
          body: JSON.stringify({ path }),
        },
      ),
    openPath: (path: string) =>
      request<{ success: boolean; path: string }>(
        "/api/agent-capabilities/open-path",
        {
          method: "POST",
          body: JSON.stringify({ path }),
        },
      ),
    mcp: () =>
      request<{ servers: import("../types").McpServerDetailedInfo[]; total: number }>(
        "/api/agent-capabilities/mcp",
      ),
    toggleMcp: (serverName: string, disabled: boolean) =>
      request<{ success: boolean; serverName: string; disabled: boolean }>(
        "/api/agent-capabilities/mcp/toggle",
        {
          method: "POST",
          body: JSON.stringify({ serverName, disabled }),
        },
      ),
    commands: () =>
      request<{ commands: import("../types").CommandDefinition[]; total: number }>(
        "/api/agent-capabilities/commands",
      ),
    toggleCommand: (cmd: string, enabled: boolean) =>
      request<{ success: boolean; cmd: string; enabled: boolean }>(
        "/api/agent-capabilities/commands/toggle",
        {
          method: "POST",
          body: JSON.stringify({ cmd, enabled }),
        },
      ),
    createCommand: (data: {
      name: string;
      cmd?: string;
      description?: string;
      usage?: string;
      argumentHint?: string;
      scope?: "user" | "workspace";
      workspaceUri?: string;
      prompt: string;
    }) =>
      request<{ success: boolean; path: string }>("/api/agent-capabilities/commands/create", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateCommand: (data: {
      path: string;
      name: string;
      cmd?: string;
      description?: string;
      usage?: string;
      argumentHint?: string;
      prompt: string;
    }) =>
      request<{ success: boolean; path: string }>("/api/agent-capabilities/commands/update", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteCommand: (path: string) =>
      request<{ success: boolean }>("/api/agent-capabilities/commands/delete", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),
    hooks: (workspaceUri?: string) =>
      request<{ hooks: import("../types").HookDefinition[]; total: number }>(
        `/api/agent-capabilities/hooks${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
      ),
    createHook: (data: {
      name?: string;
      event: string;
      scope?: "user" | "workspace";
      workspaceUri?: string;
      runType?: string;
      matcher?: string;
      command: string;
      args?: string[];
      timeout?: number;
      enabled?: boolean;
    }) =>
      request<{ success: boolean; path: string; hookName: string }>(
        "/api/agent-capabilities/hooks/create",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    updateHook: (data: {
      name: string;
      originalName?: string;
      event: string;
      originalEvent?: string;
      scope?: "user" | "workspace";
      workspaceUri?: string;
      filePath?: string;
      runType?: string;
      matcher?: string;
      command: string;
      args?: string[];
      timeout?: number;
      enabled?: boolean;
    }) =>
      request<{ success: boolean; path: string; hookName: string }>(
        "/api/agent-capabilities/hooks/update",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    toggleHook: (data: {
      name: string;
      filePath?: string;
      scope?: "user" | "workspace";
      workspaceUri?: string;
      enabled: boolean;
    }) =>
      request<{ success: boolean; enabled: boolean }>(
        "/api/agent-capabilities/hooks/toggle",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    deleteHook: (data: {
      name: string;
      event?: string;
      filePath?: string;
      scope?: "user" | "workspace";
      workspaceUri?: string;
    }) =>
      request<{ success: boolean }>(
        "/api/agent-capabilities/hooks/delete",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
  },

  statistics: {
    usage: (range: "1d" | "7d" | "30d" = "1d") =>
      request<import("../types").UsageStatisticsResponse>(
        `/api/statistics/usage?range=${range}`
      ),
  },

  gitStatus: (workspaceUri?: string) => {
    const key = workspaceUri || "default";
    const cached = gitStatusCache.get(key);
    if (cached && Date.now() - cached.time < 3000) {
      return Promise.resolve(cached.data);
    }
    return request<{
      branch: string;
      ahead: number;
      behind: number;
      files: Array<{ status: string; path: string; staged: boolean }>;
      totalChanges: number;
      error?: string;
    }>(`/api/git/status${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`).then((res) => {
      gitStatusCache.set(key, { data: res, time: Date.now() });
      return res;
    });
  },

  gitLog: (workspaceUri?: string, limit = 15) =>
    request<{
      logs: Array<{
        hash: string;
        message: string;
        author: string;
        relativeTime: string;
        date: string;
        refs?: string;
        isRemotePushed?: boolean;
        isHead?: boolean;
      }>;
      error?: string;
    }>(`/api/git/log?limit=${limit}${workspaceUri ? `&workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`),

  gitDiff: (workspaceUri?: string, fileOrOptions?: string | { file?: string; commit?: string }) => {
    let query = "";
    if (typeof fileOrOptions === "string") {
      query = `file=${encodeURIComponent(fileOrOptions)}`;
    } else if (fileOrOptions) {
      if (fileOrOptions.commit) query += `commit=${encodeURIComponent(fileOrOptions.commit)}`;
      if (fileOrOptions.file) query += `${query ? "&" : ""}file=${encodeURIComponent(fileOrOptions.file)}`;
    }
    if (workspaceUri) {
      query += `${query ? "&" : ""}workspaceUri=${encodeURIComponent(workspaceUri)}`;
    }
    return request<{ diff: string; error?: string }>(`/api/git/diff${query ? `?${query}` : ""}`);
  },

  gitPush: (body: { workspaceUri?: string; branch?: string } = {}) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/push", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitCommit: (body: { workspaceUri?: string; message: string; push?: boolean; files?: string[] }) => {
    clearGitStatusCache();
    return request<{ success?: boolean; commitOutput?: string; pushOutput?: string; error?: string }>("/api/git/commit", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitStage: (workspaceUri?: string, file?: string | string[]) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/stage", {
      method: "POST",
      body: JSON.stringify({ workspaceUri, file }),
    });
  },

  gitUnstage: (workspaceUri?: string, file?: string | string[]) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/unstage", {
      method: "POST",
      body: JSON.stringify({ workspaceUri, file }),
    });
  },

  gitDiscard: (workspaceUri?: string, file?: string | string[]) => {
    clearGitStatusCache();
    return request<{ success?: boolean; error?: string }>("/api/git/discard", {
      method: "POST",
      body: JSON.stringify({ workspaceUri, file }),
    });
  },

  gitBranches: (workspaceUri?: string) =>
    request<{
      current: string;
      branches: string[];
      local: Array<{ name: string; isCurrent: boolean; hash: string; subject: string }>;
      remote: Array<{ name: string; remote: string; branch: string; hash: string; subject: string }>;
      error?: string;
    }>(
      `/api/git/branches${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
    ),

  gitCheckout: (
    workspaceUriOrBody?: string | { workspaceUri?: string; branch: string; create?: boolean; startPoint?: string },
    branch?: string,
    create = false,
  ) => {
    clearGitStatusCache();
    const payload =
      typeof workspaceUriOrBody === "object" && workspaceUriOrBody !== null
        ? workspaceUriOrBody
        : { workspaceUri: workspaceUriOrBody, branch: branch || "", create };
    return request<{ success?: boolean; current?: string; output?: string; error?: string }>("/api/git/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  gitCreateBranch: (body: { workspaceUri?: string; name: string; checkout?: boolean }) => {
    clearGitStatusCache();
    return request<{ success?: boolean; branch?: string; output?: string; error?: string }>("/api/git/branch/create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitDeleteBranch: (body: { workspaceUri?: string; name: string; force?: boolean; isRemote?: boolean }) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/branch/delete", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitFetch: (body: { workspaceUri?: string; prune?: boolean } = {}) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/fetch", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  gitPull: (workspaceUri?: string) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/pull", {
      method: "POST",
      body: JSON.stringify({ workspaceUri }),
    });
  },

  gitAiCommit: (workspaceUri?: string, prompt?: string) =>
    request<{ message: string; diffStat?: string }>("/api/git/ai-commit-msg", {
      method: "POST",
      body: JSON.stringify({ workspaceUri, prompt }),
    }),

  terminalInfo: () =>
    request<{
      shell: string;
      platform: string;
      defaultCwd: string;
      banner: string;
    }>("/api/terminal/info"),

  terminalExec: (command: string, cwd?: string, workspaceUri?: string) =>
    request<{
      stdout: string;
      stderr: string;
      exitCode: number;
      cwd: string;
    }>("/api/terminal/exec", {
      method: "POST",
      body: JSON.stringify({ command, cwd, workspaceUri }),
    }),

  readFileText: (fileUriOrPath: string, workspaceUri?: string) =>
    request<{ path?: string; content: string; size?: number; isBinary?: boolean; error?: string }>(
      `/api/files/text?uri=${encodeURIComponent(fileUriOrPath)}${workspaceUri ? `&workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
    ),

  setExecutionMode: (executionMode: import("../types").ExecutionMode, conversationId?: string, workspaceUri?: string) =>
    request<{ ok: boolean; preset?: string; workspaceUri?: string }>("/api/execution-mode", {
      method: "POST",
      body: JSON.stringify({ executionMode, conversationId, workspaceUri }),
    }),

  getPlan: (conversationId: string) =>
    request<import("../types").ConversationPlanResponse>(
      `/api/conversations/${encodeURIComponent(conversationId)}/plan`,
    ),

  terminateTask: (conversationId: string, taskId: string) =>
    request<{ ok: boolean; status?: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/tasks/${encodeURIComponent(taskId)}/kill`,
      { method: "POST" },
    ),

  sendTaskInput: (conversationId: string, taskId: string, input: string) =>
    request<{ ok: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/tasks/${encodeURIComponent(taskId)}/input`,
      {
        method: "POST",
        body: JSON.stringify({ input }),
      },
    ),
};
