import { useMemo, useState, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { usePolling } from "./usePolling";
import type { ConversationSummary, ConversationsResponse } from "../types";

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
  const { data, error, loading, refresh } = usePolling<ConversationsResponse>(
    api.conversations,
    intervalMs,
  );

  const cachedData = useMemo(() => loadCachedConversations(), []);
  const activeData = data ?? cachedData;

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
      .filter(([id]) => !deletedIds.has(id))
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
