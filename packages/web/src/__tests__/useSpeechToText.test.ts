import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSpeechToText } from "../hooks/useSpeechToText";

describe("useSpeechToText", () => {
  const originalSpeechRecognition = window.SpeechRecognition;

  beforeEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  afterEach(() => {
    if (originalSpeechRecognition) {
      window.SpeechRecognition = originalSpeechRecognition;
    }
  });

  it("returns isSupported = false when SpeechRecognition is not present", () => {
    const { result } = renderHook(() => useSpeechToText());
    expect(result.current.isSupported).toBe(false);
  });

  it("returns isSupported = true when SpeechRecognition is present", () => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      dispatchEvent = vi.fn();
      onresult = null;
      onerror = null;
      onend = null;
    }

    window.SpeechRecognition = MockSpeechRecognition as unknown as typeof window.SpeechRecognition;

    const { result } = renderHook(() => useSpeechToText());
    expect(result.current.isSupported).toBe(true);
  });
});
