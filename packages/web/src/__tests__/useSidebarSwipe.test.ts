import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useSidebarSwipe } from "../hooks/useSidebarSwipe";

describe("useSidebarSwipe", () => {
  it("triggers onOpen when swiping right from valid swipe zone (16px ~ 50px)", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useSidebarSwipe({
        isOpen: false,
        onOpen,
        onClose,
        minEdgeOffset: 16,
        maxEdgeOffset: 50,
        threshold: 50,
      }),
    );

    // Touchstart inside valid zone (x=25)
    window.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientX: 25, clientY: 200 } as Touch],
      }),
    );

    // Touchend swiped right (x=100)
    window.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [{ clientX: 100, clientY: 200 } as Touch],
      }),
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips triggering onOpen if swipe starts in 0-15px system back gesture zone", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useSidebarSwipe({
        isOpen: false,
        onOpen,
        onClose,
        minEdgeOffset: 16,
        maxEdgeOffset: 50,
        threshold: 50,
      }),
    );

    // Touchstart at x=5 (inside system back gesture zone)
    window.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientX: 5, clientY: 200 } as Touch],
      }),
    );

    // Touchend at x=100
    window.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [{ clientX: 100, clientY: 200 } as Touch],
      }),
    );

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("triggers onClose when swiping left while open", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useSidebarSwipe({
        isOpen: true,
        onOpen,
        onClose,
      }),
    );

    // Touchstart anywhere while open
    window.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientX: 200, clientY: 200 } as Touch],
      }),
    );

    // Touchend swiped left (x=100)
    window.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [{ clientX: 100, clientY: 200 } as Touch],
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not trigger onOpen if swipe started far from edge", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useSidebarSwipe({
        isOpen: false,
        onOpen,
        onClose,
        minEdgeOffset: 16,
        maxEdgeOffset: 50,
        threshold: 50,
      }),
    );

    // Touchstart at x=100 (far outside 50px max edge)
    window.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientX: 100, clientY: 200 } as Touch],
      }),
    );

    // Touchend at x=200
    window.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [{ clientX: 200, clientY: 200 } as Touch],
      }),
    );

    expect(onOpen).not.toHaveBeenCalled();
  });
});
