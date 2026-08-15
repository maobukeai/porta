import { useMemo, useState, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { usePolling } from "./usePolling";
import type { ConversationSummary, ConversationsResponse } from "../types";
import { setConversationWaiting } from "../utils/waitingTasks";

export interface ConversationEntry {
  id: string;
  summary: ConversationSummary;
}

const CACHE_KEY = "porta_cached_conversations_v1";

function loadCachedConversations(): ConversationsResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useConversations(intervalMs = 15_000) {
  const cachedData = useMemo(() => loadCachedConversations(), []);

  const [hasRunning, setHasRunning] = useState<boolean>(() => {
    if (!cachedData?.trajectorySummaries) return false;
    return Object.values(cachedData.trajectorySummaries).some(
      (s) => s.status === "CASCADE_RUN_STATUS_RUNNING",
    );
  });

  // Fast polling (1.5s) while any task is running to ensure instant waiting status detection
  const effectiveInterval = hasRunning ? 1500 : intervalMs;

  const { data, error, loading, refresh } = usePolling<ConversationsResponse>(
    api.conversations,
    effectiveInterval,
  );

  const activeData = data ?? cachedData;

  useEffect(() => {
    if (!activeData?.trajectorySummaries) return;
    const summaries = activeData.trajectorySummaries;
    const isAnyRunning = Object.values(summaries).some(
      (s) => s.status === "CASCADE_RUN_STATUS_RUNNING",
    );
    setHasRunning(isAnyRunning);

    for (const [id, summary] of Object.entries(summaries)) {
      if ((summary as any).isWaiting !== undefined) {
        setConversationWaiting(id, Boolean((summary as any).isWaiting));
      } else if (summary.status !== "CASCADE_RUN_STATUS_RUNNING") {
        setConversationWaiting(id, false);
      }
    }
  }, [activeData]);

  useEffect(() => {
    if (data?.trajectorySummaries) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch {}
    }
  }, [data]);

  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const optimisticRemove = useCallback((id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const conversations = useMemo<ConversationEntry[]>(() => {
    if (!activeData?.trajectorySummaries) return [];

    return Object.entries(activeData.trajectorySummaries)
      .filter(([id, summary]) => {
        if (deletedIds.has(id)) return false;
        if ((summary as any).isSubagent || (summary as any)._isSubagent) return false;
        const meta = (summary as any).trajectoryMetadata;
        if (meta && (meta.isSubagent || meta.parentTrajectoryId || meta.parentCascadeId || meta.spawnedBy)) {
          return false;
        }
        const title = String(summary.summary || "");
        if (
          title.startsWith("[Subagent]") ||
          title.startsWith("subagent:") ||
          title.startsWith("子智能体") ||
          /^🤖\s*子智能体/i.test(title) ||
          /Usage Statistics Auditor/i.test(title) ||
          /数据统计功能代码审查/i.test(title)
        ) {
          return false;
        }
        return true;
      })
      .map(([id, summary]) => ({ id, summary }))
      .sort(
        (a, b) =>
          new Date(b.summary.lastModifiedTime).getTime() -
          new Date(a.summary.lastModifiedTime).getTime(),
      );
  }, [activeData, deletedIds]);

  const isInitialLoading = loading && !activeData;

  return { conversations, error, loading: isInitialLoading, refresh, optimisticRemove };
}
