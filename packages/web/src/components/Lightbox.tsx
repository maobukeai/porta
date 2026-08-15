import { useCallback, useRef, useState } from "react";

/** Fullscreen image lightbox with swipe-down-to-dismiss */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const DISMISS_THRESHOLD = 120;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    setDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - startY.current;
    // Only allow downward drag
    setDragY(Math.max(0, dy));
  }, []);

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    if (dragY > DISMISS_THRESHOLD) {
      onClose();
    } else {
      setDragY(0);
    }
  }, [dragY, onClose]);

  const progress = Math.min(dragY / DISMISS_THRESHOLD, 1);
  const overlayOpacity = 0.9 - progress * 0.5;

  return (
    <div
      className="lightbox-overlay"
      style={{ backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})` }}
      onClick={onClose}
    >
      <img
        src={src}
        className="lightbox-img"
        alt="Expanded"
        style={{
          transform: `translateY(${dragY}px) scale(${1 - progress * 0.1})`,
          transition: dragging ? "none" : "transform 0.25s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}
