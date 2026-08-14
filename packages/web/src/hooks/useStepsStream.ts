import { useCallback, useEffect, useRef, useState } from "react";
import { api, getApiBase } from "../api/client";
import type { TrajectoryStep } from "../types";
import { useAppResume } from "./useAppResume";

/** How many steps to fetch on initial load and each lazy-load page. */
const PAGE_SIZE = 100;

interface UseStepsStreamResult {
  /** All loaded steps (ordered oldest → newest). */
  steps: TrajectoryStep[];
  /** Absolute offset of steps[0] in the full trajectory (used for correct revert stepIndex). */
  baseOffset: number;
  loading: boolean;
  error: string | null;
  /** Whether older steps exist above the currently loaded window. */
  hasMore: boolean;
  /** True while a loadOlder request is in flight. */
  loadingOlder: boolean;
  /** WS-driven running state — instant, not dependent on 15s sidebar poll. */
  wsRunning: boolean;
  /** Load the next page of older steps. Returns the count prepended. */
  loadOlder: () => Promise<number>;
  /** Soft refresh: merge new steps without clearing existing messages. */
  refresh: () => void;
  /** Hard refresh: full nuke-and-reload (for revert/stop). */
  hardRefresh: () => void;
}

/**
 * Chat steps hook: HTTP for initial + lazy load, WS for real-time deltas.
 *
 * Initial flow:
 *   1. HTTP GET /steps?limit=PAGE_SIZE → latest page of steps
 *   2. Open WS → receive { type: "ready", stepCount }
 *   3. Send WS { type: "sync", fromOffset: loadedOffset + loadedCount }
 *      so WS delta polling picks up from where HTTP left off
 *   4. WS pushes { type: "steps", offset, steps } for new/updated steps
 *
 * Lazy load (scroll up):
 *   5. HTTP GET /steps?offset=X → older page
 *   6. Prepend to steps array
 */
const MAX_CACHE_SIZE = 50;
const stepsMemoryCache = new Map<string, { steps: TrajectoryStep[]; baseOffset: number; endOffset: number }>();

function setStepsCache(cascadeId: string, value: { steps: TrajectoryStep[]; baseOffset: number; endOffset: number }) {
  if (stepsMemoryCache.has(cascadeId)) {
    stepsMemoryCache.delete(cascadeId);
  } else if (stepsMemoryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = stepsMemoryCache.keys().next().value;
    if (oldestKey) stepsMemoryCache.delete(oldestKey);
  }
  stepsMemoryCache.set(cascadeId, value);
}

export function getStepsFromCache(cascadeId: string): TrajectoryStep[] {
  return stepsMemoryCache.get(cascadeId)?.steps ?? [];
}

export function prefetchSteps(cascadeId: string): void {
  if (!cascadeId || stepsMemoryCache.has(cascadeId)) return;
  api.getSteps(cascadeId, 0, 100).then((res) => {
    if (res.steps) {
      setStepsCache(cascadeId, {
        steps: res.steps,
        baseOffset: res.offset ?? 0,
        endOffset: (res.offset ?? 0) + res.steps.length,
      });
    }
  }).catch(() => {});
}

export function useStepsStream(
  cascadeId: string,
  totalStepCount?: number,
  onIdleTransition?: () => void,
  isConversationRunning = false,
  keepAliveWhenHidden = false,
): UseStepsStreamResult {
  const cached = cascadeId ? stepsMemoryCache.get(cascadeId) : null;
  const [steps, setSteps] = useState<TrajectoryStep[]>(() => cached?.steps ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [wsRunning, setWsRunning] = useState(false);

  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWsDeltaTimeRef = useRef<number>(0);
  const stepsRef = useRef<TrajectoryStep[]>(cached?.steps ?? []);
  // The absolute offset of stepsRef[0] in the full trajectory.
  const baseOffsetRef = useRef(cached?.baseOffset ?? 0);
  // The exact offset of the NEXT step AFTER the end of stepsRef.
  const endOffsetRef = useRef(cached?.endOffset ?? 0);
  // Monotonic generation counter — prevents stale responses from overwriting.
  const genRef = useRef(0);
  const bumpGeneration = useCallback(() => {
    genRef.current += 1;
  }, []);

  const rafIdRef = useRef<number | null>(null);
  const scheduleStepsFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (mountedRef.current) {
        setSteps([...stepsRef.current]);
      }
    });
  }, []);

  useEffect(() => {
    if (cascadeId && steps.length > 0) {
      setStepsCache(cascadeId, {
        steps,
        baseOffset: baseOffsetRef.current,
        endOffset: endOffsetRef.current,
      });
    }
  }, [cascadeId, steps]);
  const totalRef = useRef(totalStepCount ?? 0);
  totalRef.current = totalStepCount ?? 0;

  const onIdleRef = useRef(onIdleTransition);
  onIdleRef.current = onIdleTransition;
  const runningHintRef = useRef(isConversationRunning);
  runningHintRef.current = isConversationRunning;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const initialFetch = useCallback(async () => {
    const gen = genRef.current;
    try {
      // Calculate starting offset from the known total step count.
      // If we don't know the count, we use the `tail` parameter to let the proxy compute it.
      const isUnknown = totalRef.current === 0;
      const startOffset = isUnknown
        ? 0
        : Math.max(0, totalRef.current - PAGE_SIZE);
      console.debug(
        `[useStepsStream] initialFetch cascadeId=${cascadeId.slice(0, 8)} gen=${gen} total=${totalRef.current} isUnknown=${isUnknown} startOffset=${startOffset}`,
      );
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      let result: Awaited<ReturnType<typeof api.getSteps>>;
      try {
        result = await api.getSteps(
          cascadeId,
          startOffset,
          undefined,
          isUnknown ? PAGE_SIZE : undefined,
        );
      } finally {
        clearTimeout(timeoutId);
      }
      console.debug(
        `[useStepsStream] initialFetch result: mounted=${mountedRef.current} gen=${gen}==${genRef.current} steps=${(result.steps ?? []).length} offset=${result.offset}`,
      );
      if (!mountedRef.current || gen !== genRef.current) return;

      const fetchedSteps = result.steps ?? [];
      const offset = result.offset ?? startOffset;

      baseOffsetRef.current = offset;
      endOffsetRef.current = offset + fetchedSteps.length;
      stepsRef.current = fetchedSteps;
      setSteps([...fetchedSteps]);
      setHasMore(offset > 0);
      setLoading(false);
      setError(null);

      // Return the total so WS can sync from the right point
      return { offset, count: fetchedSteps.length };
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      return null;
    }
  }, [cascadeId]);

  // ── WS: connect for deltas ──
  const connectWs = useCallback(
    (syncOffset: number) => {
      if (!mountedRef.current) return;
      clearReconnectTimer();

      const existing = wsRef.current;
      if (existing && existing.readyState < WebSocket.CLOSING) {
        return;
      }

      // Use getApiBase() so custom proxy address (set in SettingsPanel) also
      // applies to the WebSocket connection, not just HTTP requests.
      const apiBase = getApiBase();
      const isNative = Boolean(
        (window as any).Capacitor?.isNativePlatform?.() ||
          (window as any).Capacitor?.platform === "android" ||
          (window as any).Capacitor?.platform === "ios",
      );
      let url: string;
      if (apiBase) {
        const wsBase = apiBase.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
        url = `${wsBase}/api/conversations/${cascadeId}/ws`;
      } else if (isNative) {
        // Capacitor native app with no proxy configured: do NOT connect to ws://localhost
        // (localhost on the device has no proxy server). The SetupWizard guides the user
        // to configure the proxy IP first.
        console.warn("[useStepsStream] WebSocket skipped: native app with no proxy address configured");
        return;
      } else if (window.location.host) {
        // Browser / PWA environment: use relative WS URL
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        url = `${protocol}//${window.location.host}/api/conversations/${cascadeId}/ws`;
      } else {
        // file:// protocol — no valid host, skip
        console.warn("[useStepsStream] WebSocket skipped: file:// protocol with no proxy configured");
        return;
      }
      const gen = genRef.current;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (
            !mountedRef.current ||
            gen !== genRef.current ||
            wsRef.current !== ws
          ) {
            ws.close();
            return;
          }

          // Tell proxy to start deltas from where our HTTP load ended
          ws.send(JSON.stringify({ type: "sync", fromOffset: syncOffset }));
        };

        ws.onmessage = (event) => {
          if (
            !mountedRef.current ||
            gen !== genRef.current ||
            wsRef.current !== ws
          ) {
            return;
          }
          lastWsDeltaTimeRef.current = Date.now();
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "ready") {
              // Proxy acknowledged connection with stepCount.
              // We already have initial data from HTTP, so just note it.
              return;
            }

            if (msg.type === "status") {
              // Instant running state from the proxy's adaptive polling.
              const running = !!msg.running;
              setWsRunning(running);
              if (!running) {
                // Agent just went idle — trigger sidebar refresh for metadata update
                onIdleRef.current?.();
              }
              return;
            }

            if (msg.type === "steps") {
              const deltaOffset: number = msg.offset ?? endOffsetRef.current;
              const newSteps: TrajectoryStep[] = msg.steps ?? [];
              if (newSteps.length === 0) return;

              // Calculate position relative to the END of our loaded window
              // (safely handles inner array gaps from lazy-loaded older steps)
              const relOffset =
                stepsRef.current.length + (deltaOffset - endOffsetRef.current);

              if (relOffset >= 0) {
                // Delta overlaps or extends our loaded window — merge
                const updated = stepsRef.current
                  .slice(0, relOffset)
                  .concat(newSteps);
                stepsRef.current = updated;
                endOffsetRef.current = deltaOffset + newSteps.length;
                scheduleStepsFlush();
              }
            }
          } catch {
            // Ignore malformed messages
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current || gen !== genRef.current) return;

          if (wsRef.current === ws) {
            wsRef.current = null;
          }

          if (
            typeof document !== "undefined" &&
            document.hidden &&
            !keepAliveWhenHidden
          ) {
            return;
          }

          const current = wsRef.current;
          if (current && current.readyState < WebSocket.CLOSING) return;

          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;

            if (!mountedRef.current || gen !== genRef.current) return;
            if (
              typeof document !== "undefined" &&
              document.hidden &&
              !keepAliveWhenHidden
            ) {
              return;
            }

            const activeSocket = wsRef.current;
            if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
              return;
            }

            connectWs(endOffsetRef.current);
          }, 2000);
        };

        ws.onerror = () => {
          // onclose handles cleanup
        };
      } catch {
        // WS not available — no real-time updates
      }
    },
    [cascadeId, clearReconnectTimer, keepAliveWhenHidden],
  );

  // ── Lifecycle: fetch + connect ──
  useEffect(() => {
    mountedRef.current = true;
    bumpGeneration();
    stepsRef.current = [];
    baseOffsetRef.current = 0;
    endOffsetRef.current = 0;
    setSteps([]);
    setLoading(true);
    setError(null);
    setHasMore(false);

    (async () => {
      // Launch WS immediately (parallel with HTTP) so the real-time channel
      // is ready sooner. We'll re-sync after HTTP tells us the actual offset.
      connectWs(0);

      const result = await initialFetch();
      if (!result || !mountedRef.current) return;

      // If WS is already open, send a sync message with the correct offset
      const syncFrom = result.offset + result.count;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "sync", fromOffset: syncFrom }));
      } else if (!ws || ws.readyState >= WebSocket.CLOSING) {
        // WS not yet open or already closed — reconnect with correct offset
        connectWs(syncFrom);
      }
    })();

    return () => {
      mountedRef.current = false;
      bumpGeneration();
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [initialFetch, connectWs, clearReconnectTimer, bumpGeneration]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      if (keepAliveWhenHidden) return;

      clearReconnectTimer();
      setWsRunning(false);

      const socket = wsRef.current;
      wsRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearReconnectTimer, keepAliveWhenHidden]);

  // ── Lazy load older steps ──
  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingOlder || baseOffsetRef.current <= 0) return 0;
    setLoadingOlder(true);
    const gen = genRef.current;

    try {
      const end = baseOffsetRef.current;
      const fetchOffset = Math.max(0, end - PAGE_SIZE);
      const limit = end - fetchOffset;

      const result = await api.getSteps(cascadeId, fetchOffset, limit);
      if (!mountedRef.current || gen !== genRef.current) return 0;

      const olderSteps = result.steps ?? [];
      if (olderSteps.length === 0) {
        setHasMore(false);
        return 0;
      }

      // The proxy returns the actual offset it used
      const actualOffset = result.offset ?? fetchOffset;

      // Prepend to existing steps
      baseOffsetRef.current = actualOffset;
      stepsRef.current = [...olderSteps, ...stepsRef.current];
      setSteps([...stepsRef.current]);
      setHasMore(actualOffset > 0);

      return olderSteps.length;
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return 0;
      console.error("Failed to load older steps:", err);
      return 0;
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [cascadeId, loadingOlder]);

  const syncLatestSteps = useCallback(
    async (reconnectMode: "always" | "if-running") => {
      const gen = genRef.current;

      try {
        const hasExistingSteps = stepsRef.current.length > 0;
        const isUnknown = totalRef.current === 0;
        const startOffset = hasExistingSteps
          ? Math.max(0, endOffsetRef.current - 15)
          : isUnknown
            ? 0
            : Math.max(0, totalRef.current - PAGE_SIZE);

        const [result, convRes] = await Promise.all([
          api.getSteps(
            cascadeId,
            startOffset,
            undefined,
            isUnknown && !hasExistingSteps ? PAGE_SIZE : undefined,
          ),
          api.getConversation(cascadeId).catch(() => null),
        ]);

        if (!mountedRef.current || gen !== genRef.current) return;

        if (convRes) {
          const isRunningOnServer =
            convRes.status === "CASCADE_RUN_STATUS_RUNNING";
          setWsRunning(isRunningOnServer);
          if (!isRunningOnServer && wsRunning) {
            onIdleRef.current?.();
          }
        }

        const fetchedSteps = result.steps ?? [];
        const fetchedOffset = result.offset ?? startOffset;

        if (stepsRef.current.length === 0) {
          // First load — just set everything
          baseOffsetRef.current = fetchedOffset;
          endOffsetRef.current = fetchedOffset + fetchedSteps.length;
          stepsRef.current = fetchedSteps;
          setSteps([...fetchedSteps]);
          setHasMore(fetchedOffset > 0);
          setLoading(false);
        } else {
          // Merge by replacing the fetched window while keeping older/newer
          // segments outside it. This preserves in-place step updates.
          const currentBase = baseOffsetRef.current;
          const currentEnd = currentBase + stepsRef.current.length;
          const fetchedEnd = fetchedOffset + fetchedSteps.length;
          const keepPrefixCount = Math.max(0, fetchedOffset - currentBase);
          const keepSuffixFrom = Math.max(0, fetchedEnd - currentBase);
          const merged = [
            ...stepsRef.current.slice(0, keepPrefixCount),
            ...fetchedSteps,
            ...stepsRef.current.slice(keepSuffixFrom),
          ];

          const newBase = Math.min(currentBase, fetchedOffset);
          baseOffsetRef.current = newBase;
          endOffsetRef.current = Math.max(currentEnd, fetchedEnd);
          stepsRef.current = merged;
          setSteps([...merged]);
          setHasMore(newBase > 0);
        }
        setError(null);

        const socket = wsRef.current;
        const socketAlive =
          !!socket && socket.readyState < WebSocket.CLOSING;
        if (socketAlive) return;

        if (
          reconnectMode === "always" ||
          convRes?.status === "CASCADE_RUN_STATUS_RUNNING"
        ) {
          connectWs(endOffsetRef.current);
        }
      } catch (err) {
        if (!mountedRef.current || gen !== genRef.current) return;
        console.error("Soft refresh failed:", err);
      }
    },
    [cascadeId, connectWs, wsRunning],
  );

  // ── Soft refresh: merge new steps without clearing existing messages ──
  const refresh = useCallback(() => {
    void syncLatestSteps("always");
  }, [syncLatestSteps]);

  // ── Adaptive Polling Fallback: guarantees 100% real-time streaming even if WebSocket fails on mobile APK ──
  useEffect(() => {
    if (!cascadeId) return;

    let isCancelled = false;

    const pollLoop = async () => {
      if (isCancelled || !mountedRef.current) return;

      const isWsOpen = wsRef.current?.readyState === WebSocket.OPEN;
      const timeSinceWsDelta = Date.now() - lastWsDeltaTimeRef.current;
      const isRunningState = wsRunning || runningHintRef.current;

      // Poll HTTP if:
      // 1. WebSocket is NOT connected/open.
      // 2. Or we are in a running state AND haven't received a WS delta in > 2000ms.
      const needsHttpPoll = !isWsOpen || (isRunningState && timeSinceWsDelta > 2000);

      if (needsHttpPoll) {
        await syncLatestSteps(isRunningState ? "always" : "if-running");
      }

      if (isCancelled || !mountedRef.current) return;

      // Poll every 1000ms while running for smooth streaming, every 3500ms while idle
      const nextDelay = isRunningState ? 1000 : 3500;
      pollingTimerRef.current = setTimeout(pollLoop, nextDelay);
    };

    pollingTimerRef.current = setTimeout(pollLoop, 1000);

    return () => {
      isCancelled = true;
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [cascadeId, wsRunning, isConversationRunning, syncLatestSteps]);

  useAppResume(() => {
    // Even while idle we keep a WS open so the proxy can detect
    // externally-started runs. If the tab was backgrounded, always restore
    // that channel on resume instead of waiting for the next mutation.
    void syncLatestSteps("always");
  });

  // ── Hard refresh: full nuke-and-reload (for revert/stop) ──
  const hardRefresh = useCallback(() => {
    genRef.current++;
    stepsRef.current = [];
    baseOffsetRef.current = 0;
    endOffsetRef.current = 0;
    setSteps([]);
    setLoading(true);
    setError(null);
    setHasMore(false);

    if (wsRef.current) {
      clearReconnectTimer();
      wsRef.current.close();
      wsRef.current = null;
    }

    (async () => {
      const result = await initialFetch();
      if (!result || !mountedRef.current) return;
      const syncFrom = result.offset + result.count;
      connectWs(syncFrom);
    })();
  }, [initialFetch, connectWs, clearReconnectTimer]);

  return {
    steps,
    baseOffset: baseOffsetRef.current,
    loading,
    error,
    hasMore,
    loadingOlder,
    wsRunning,
    loadOlder,
    refresh,
    hardRefresh,
  };
}
