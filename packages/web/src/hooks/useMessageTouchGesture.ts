import { useRef, useEffect } from "react";
import { triggerHaptic } from "../utils/haptics";

interface MessageTouchOptions {
  onLongPress?: () => void;
  longPressDelay?: number; // ms threshold, default 400
  enabled?: boolean;
}

/**
 * Mobile long-press gesture hook for chat message cards.
 */
export function useMessageTouchGesture<T extends HTMLElement = HTMLElement>({
  onLongPress,
  longPressDelay = 400,
  enabled = true,
}: MessageTouchOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<T>) => {
    if (!enabled || e.touches.length !== 1 || !onLongPress) return;

    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    clearTimer();
    timerRef.current = setTimeout(() => {
      triggerHaptic("medium");
      onLongPress();
      clearTimer();
    }, longPressDelay);
  };

  const handleTouchMove = (e: React.TouchEvent<T>) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

    // Cancel long press if user moved finger more than 10px
    if (dx > 10 || dy > 10) {
      clearTimer();
    }
  };

  const handleTouchEnd = () => {
    clearTimer();
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
  };
}
