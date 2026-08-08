import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMessageTouchGesture } from "../hooks/useMessageTouchGesture";

describe("useMessageTouchGesture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers onLongPress after longPressDelay", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useMessageTouchGesture({ onLongPress, longPressDelay: 400 }),
    );

    const mockEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent<HTMLDivElement>;

    act(() => {
      result.current.onTouchStart(mockEvent);
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("cancels longPress if touch moves too far", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useMessageTouchGesture({ onLongPress, longPressDelay: 400 }),
    );

    const startEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent<HTMLDivElement>;

    const moveEvent = {
      touches: [{ clientX: 150, clientY: 100 }],
    } as unknown as React.TouchEvent<HTMLDivElement>;

    act(() => {
      result.current.onTouchStart(startEvent);
      result.current.onTouchMove(moveEvent);
      vi.advanceTimersByTime(400);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
