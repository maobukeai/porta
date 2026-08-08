import { useEffect, useRef } from "react";
import { triggerHaptic } from "../utils/haptics";

interface Options {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Min distance from left edge in pixels to avoid system back gesture (default 16px) */
  minEdgeOffset?: number;
  /** Max distance from left edge in pixels to start swipe-to-open (default 50px) */
  maxEdgeOffset?: number;
  /** Min horizontal swipe threshold distance to trigger open/close (default 50px) */
  threshold?: number;
}

/**
 * Hook to handle mobile touch edge-swipe gesture to open sidebar
 * and left-swipe gesture on drawer to close sidebar.
 * Automatically skips 0-16px edge zone to prevent conflict with iOS/Android system back gesture.
 */
export function useSidebarSwipe({
  isOpen,
  onOpen,
  onClose,
  minEdgeOffset = 16,
  maxEdgeOffset = 50,
  threshold = 50,
}: Options) {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  const isEdgeSwipeRef = useRef(false);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const startX = touch.clientX;
      const startY = touch.clientY;

      touchStartRef.current = { x: startX, y: startY, time: Date.now() };

      // If sidebar is closed, skip 0-16px system back gesture zone to avoid collision
      if (!isOpen && startX >= minEdgeOffset && startX <= maxEdgeOffset) {
        isEdgeSwipeRef.current = true;
      } else if (isOpen) {
        // If sidebar is open, any horizontal swipe starting anywhere can close
        isEdgeSwipeRef.current = true;
      } else {
        isEdgeSwipeRef.current = false;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current || !isEdgeSwipeRef.current) {
        touchStartRef.current = null;
        isEdgeSwipeRef.current = false;
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const duration = Date.now() - touchStartRef.current.time;

      // Ensure horizontal swipe is dominant over vertical scroll
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && duration < 500) {
        if (!isOpen && deltaX >= threshold) {
          triggerHaptic("medium");
          onOpen();
        } else if (isOpen && deltaX <= -threshold) {
          triggerHaptic("light");
          onClose();
        }
      }

      touchStartRef.current = null;
      isEdgeSwipeRef.current = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isOpen, onOpen, onClose, minEdgeOffset, maxEdgeOffset, threshold]);
}
