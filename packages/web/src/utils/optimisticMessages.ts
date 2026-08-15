import type { ChatMessage } from "../types";

export interface MergeOptimisticMessagesResult {
  messages: ChatMessage[];
  confirmedOptimisticIds: string[];
  hasUnconfirmedOptimistic: boolean;
}

export function isUnconfirmedOptimisticMessage(msg: ChatMessage): boolean {
  return msg.optimisticState === "unconfirmed";
}

/**
 * Reconcile optimistic user messages against server-confirmed client IDs that
 * the proxy annotates onto confirmed user-input steps.
 */
export function mergeOptimisticMessages(
  serverMessages: ChatMessage[],
  optimisticMessages: ChatMessage[],
): MergeOptimisticMessagesResult {
  if (optimisticMessages.length === 0) {
    return {
      messages: serverMessages,
      confirmedOptimisticIds: [],
      hasUnconfirmedOptimistic: false,
    };
  }

  const confirmedOptimisticIds = serverMessages.flatMap((msg) =>
    msg.role === "user" && msg.optimisticId ? [msg.optimisticId] : [],
  );
  const confirmedIdSet = new Set(confirmedOptimisticIds);

  const remainingOptimisticMessages = optimisticMessages.filter(
    (msg) =>
      !(
        msg.role === "user" &&
        msg.optimisticId &&
        confirmedIdSet.has(msg.optimisticId)
      ),
  );
  const activeOptimisticMessages = remainingOptimisticMessages.filter(
    (msg) => msg.optimisticState !== "failed",
  );

  const rawCombined = [...serverMessages, ...remainingOptimisticMessages];
  const deduplicatedMessages: ChatMessage[] = [];
  for (const msg of rawCombined) {
    const isError = msg.type === "error" || msg.icon === "alert";
    const prev = deduplicatedMessages[deduplicatedMessages.length - 1];
    const prevIsError = prev && (prev.type === "error" || prev.icon === "alert");
    if (isError && prevIsError && (prev.content === msg.content || !msg.content)) {
      continue;
    }
    deduplicatedMessages.push(msg);
  }

  return {
    messages: deduplicatedMessages,
    confirmedOptimisticIds,
    hasUnconfirmedOptimistic: activeOptimisticMessages.length > 0,
  };
}
