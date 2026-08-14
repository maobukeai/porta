import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useStepsStream } from "../hooks/useStepsStream";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== MockWebSocket.CONNECTING) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState >= MockWebSocket.CLOSING) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event("close"));
  }
}

describe("useStepsStream", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("reconnects on resume even when the conversation is idle", async () => {
    const getSteps = vi
      .spyOn(api, "getSteps")
      .mockResolvedValue({ steps: [], offset: 0 });
    const getConversation = vi
      .spyOn(api, "getConversation")
      .mockRejectedValue(new Error("getConversation should not be called"));

    renderHook(() => useStepsStream("cascade-1", 0, undefined, false));

    await waitFor(() => {
      expect(getSteps).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    await waitFor(() => {
      expect(MockWebSocket.instances[0].sent).toContain(
        JSON.stringify({ type: "sync", fromOffset: 0 }),
      );
    });

    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);

    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(getSteps).toHaveBeenCalledTimes(2);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    expect(getConversation).toHaveBeenCalledWith("cascade-1");
  });
});
