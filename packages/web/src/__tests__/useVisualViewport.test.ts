import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useVisualViewport } from "../hooks/useVisualViewport";

describe("useVisualViewport", () => {
  const originalVisualViewport = window.visualViewport;

  beforeEach(() => {
    // Reset CSS properties and body classes
    document.documentElement.style.removeProperty("--visual-viewport-height");
    document.documentElement.style.removeProperty("--visual-viewport-offset-top");
    document.documentElement.style.removeProperty("--keyboard-height");
    document.body.classList.remove("keyboard-visible");
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      writable: true,
      configurable: true,
      value: originalVisualViewport,
    });
  });

  it("returns window.innerHeight when visualViewport is not supported", () => {
    Object.defineProperty(window, "visualViewport", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useVisualViewport());
    expect(result.current.height).toBe(window.innerHeight);
    expect(result.current.isKeyboardVisible).toBe(false);
  });

  it("updates state and CSS variables on visualViewport resize/scroll", () => {
    const listeners = new Set<() => void>();
    const mockVV = {
      height: 800,
      offsetTop: 0,
      addEventListener: vi.fn((_event: string, cb: () => void) => {
        listeners.add(cb);
      }),
      removeEventListener: vi.fn((_event: string, cb: () => void) => {
        listeners.delete(cb);
      }),
    };

    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: 800,
    });

    Object.defineProperty(window, "visualViewport", {
      writable: true,
      configurable: true,
      value: mockVV,
    });

    const { result } = renderHook(() => useVisualViewport());
    expect(result.current.isKeyboardVisible).toBe(false);

    // Simulate soft keyboard opening (height drops to 500px)
    act(() => {
      mockVV.height = 500;
      listeners.forEach((cb) => cb());
    });

    expect(result.current.height).toBe(500);
    expect(result.current.keyboardHeight).toBe(300);
    expect(result.current.isKeyboardVisible).toBe(true);
    expect(document.body.classList.contains("keyboard-visible")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--keyboard-height")).toBe("300px");
  });
});
