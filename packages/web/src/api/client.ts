const API_BASE = import.meta.env.VITE_API_BASE ?? "";

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
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {
      msg = body;
    }
    throw new Error(`API ${res.status}: ${msg}`);
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

  startConversation: (workspaceUri?: string, fileAccessGranted = false) =>
    request<{ cascadeId: string }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        ...(workspaceUri ? { workspaceFolderAbsoluteUri: workspaceUri } : {}),
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
      };
    }>("/api/user-status"),

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

  commands: () =>
    request<{
      commands: Array<{
        name: string;
        desc: string;
        category?: "slash" | "skill" | "plugin" | "mcp";
      }>;
    }>("/api/commands"),

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

  gitDiff: (workspaceUri?: string, file?: string) =>
    request<{ diff: string; error?: string }>(
      `/api/git/diff${file ? `?file=${encodeURIComponent(file)}` : "?"}${workspaceUri ? `&workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
    ),

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
    request<{ current: string; branches: string[]; error?: string }>(
      `/api/git/branches${workspaceUri ? `?workspaceUri=${encodeURIComponent(workspaceUri)}` : ""}`,
    ),

  gitCheckout: (workspaceUri?: string, branch?: string, create = false) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/checkout", {
      method: "POST",
      body: JSON.stringify({ workspaceUri, branch, create }),
    });
  },

  gitPull: (workspaceUri?: string) => {
    clearGitStatusCache();
    return request<{ success?: boolean; output?: string; error?: string }>("/api/git/pull", {
      method: "POST",
      body: JSON.stringify({ workspaceUri }),
    });
  },

  gitAiCommit: (workspaceUri?: string) =>
    request<{ message: string; diffStat?: string }>("/api/git/ai-commit-msg", {
      method: "POST",
      body: JSON.stringify({ workspaceUri }),
    }),
};
