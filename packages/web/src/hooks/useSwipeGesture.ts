import { useEffect, useRef } from "react";
import { triggerHaptic } from "../utils/haptics";

interface SwipeOptions {
  onSwipeRightFromEdge?: () => void;
  onSwipeLeft?: () => void;
  edgeThreshold?: number; // max startX from screen edge (default 35px)
  minDistance?: number; // min horizontal swipe distance (default 60px)
  maxVerticalRatio?: number; // max dy / dx ratio to avoid triggering on scroll
  enabled?: boolean;
}

/**
 * Mobile swipe gesture hook for edge drawer opening and swipe-to-close.
 */
export function useSwipeGesture({
  onSwipeRightFromEdge,
  onSwipeLeft,
  edgeThreshold = 35,
  minDistance = 60,
  maxVerticalRatio = 0.65,
  enabled = true,
}: SwipeOptions) {
  const startRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!startRef.current || e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      const startX = startRef.current.x;
      const duration = Date.now() - startRef.current.time;
      startRef.current = null;

      // Ignore slow drags (> 600ms) or mostly vertical scrolls
      if (duration > 600) return;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < minDistance || absDy / absDx > maxVerticalRatio) {
        return;
      }

      // Swipe right from left edge -> open drawer
      if (dx > 0 && startX <= edgeThreshold && onSwipeRightFromEdge) {
        triggerHaptic("medium");
        onSwipeRightFromEdge();
      }

      // Swipe left anywhere -> close drawer if open
      if (dx < 0 && onSwipeLeft) {
        triggerHaptic("light");
        onSwipeLeft();
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onSwipeRightFromEdge, onSwipeLeft, edgeThreshold, minDistance, maxVerticalRatio, enabled]);
}
