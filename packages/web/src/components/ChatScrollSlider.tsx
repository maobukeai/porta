import React, {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface ChatScrollSliderProps {
  targetRef: RefObject<HTMLElement | null>;
}

export function ChatScrollSlider({ targetRef }: ChatScrollSliderProps) {
  const [canScroll, setCanScroll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const isHoveredRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);
  const thumbHeightRef = useRef(40);

    const ARROW_SPACE = 16;
  const BOTTOM_SPACE = 8;
  const MIN_THUMB_HEIGHT = 36;
  // Base height used for scaleY trick — CSS must match this value
  const THUMB_BASE_HEIGHT = 40;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) {
      setCanScroll(false);
      return;
    }

    const checkScrollable = () => {
      const { scrollHeight, clientHeight } = el;
      const isScrollable = scrollHeight - clientHeight > 5;
      setCanScroll((prev) => (prev !== isScrollable ? isScrollable : prev));
      return isScrollable;
    };

    let rafId: number | null = null;

    const updateMetrics = () => {
      const container = containerRef.current;
      const thumb = thumbRef.current;
      if (!container || !thumb) return;

      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 5) return;

      const availableTrackHeight = Math.max(
        20,
        clientHeight - ARROW_SPACE - BOTTOM_SPACE,
      );
      const ratio = clientHeight / scrollHeight;
      const thumbHeight = Math.max(
        MIN_THUMB_HEIGHT,
        Math.min(availableTrackHeight * 0.8, ratio * availableTrackHeight),
      );
      const maxThumbTop = availableTrackHeight - thumbHeight;
      const thumbTop =
        ARROW_SPACE + (scrollTop / maxScroll) * maxThumbTop;

      const clampedTop = Math.max(ARROW_SPACE, Math.min(ARROW_SPACE + maxThumbTop, thumbTop));
      thumbHeightRef.current = thumbHeight;

      // Use scaleY instead of height to avoid reflow — only GPU compositor layer needed
      const scale = thumbHeight / THUMB_BASE_HEIGHT;
      thumb.style.transform = `translate3d(0, ${clampedTop}px, 0) scaleY(${scale})`;
    };

    const triggerVisibility = () => {
      const container = containerRef.current;
      if (!container) return;
      container.classList.add("visible");
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        if (!isDraggingRef.current && !isHoveredRef.current) {
          container.classList.remove("visible");
        }
      }, 1200);
    };

    const onScroll = () => {
      triggerVisibility();
      // Schedule a single RAF — do NOT call updateMetrics() synchronously here.
      // Synchronous DOM reads/writes in the scroll handler cause layout thrashing.
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateMetrics();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        checkScrollable();
        updateMetrics();
      });
      resizeObserver.observe(el);
    }

    checkScrollable();
    updateMetrics();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [targetRef]);

  // Handle pointer drag on thumb
  const handleThumbPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const el = targetRef.current;
    if (!el) return;

    isDraggingRef.current = true;
    containerRef.current?.classList.add("dragging", "visible");
    thumbRef.current?.classList.add("active");
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = el.scrollTop;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleThumbPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const el = targetRef.current;
    if (!el) return;

    const { scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const availableTrackHeight = Math.max(
      20,
      clientHeight - ARROW_SPACE - BOTTOM_SPACE,
    );
    const maxThumbTop = availableTrackHeight - thumbHeightRef.current;

    if (maxThumbTop <= 0 || maxScroll <= 0) return;

    const deltaY = e.clientY - dragStartYRef.current;
    const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
    el.scrollTop = Math.max(
      0,
      Math.min(maxScroll, dragStartScrollTopRef.current + scrollDelta),
    );
  };

  const handleThumbPointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      containerRef.current?.classList.remove("dragging");
      thumbRef.current?.classList.remove("active");
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      if (!isHoveredRef.current) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          containerRef.current?.classList.remove("visible");
        }, 1200);
      }
    }
  };

  // Click track to jump
  const handleTrackClick = (e: React.MouseEvent) => {
    const el = targetRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const rect = container.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    if (clickY < ARROW_SPACE) return;

    const { scrollHeight, clientHeight } = el;
    const maxScroll = scrollHeight - clientHeight;
    const availableTrackHeight = Math.max(
      20,
      clientHeight - ARROW_SPACE - BOTTOM_SPACE,
    );
    const ratio = (clickY - ARROW_SPACE) / availableTrackHeight;
    el.scrollTo({
      top: Math.max(0, Math.min(maxScroll, ratio * maxScroll)),
      behavior: "smooth",
    });
  };

  const handleScrollToTop = (e: React.MouseEvent) => {
    e.stopPropagation();
    targetRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!canScroll) return null;

  return (
    <div
      ref={containerRef}
      className="chat-scroll-slider-track"
      onMouseEnter={() => {
        isHoveredRef.current = true;
        containerRef.current?.classList.add("visible");
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        if (!isDraggingRef.current) {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => {
            containerRef.current?.classList.remove("visible");
          }, 800);
        }
      }}
      onClick={handleTrackClick}
      aria-hidden="true"
    >
      <button
        className="chat-scroll-slider-arrow"
        onClick={handleScrollToTop}
        title="回到顶部"
        tabIndex={-1}
      >
        <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
          <polygon points="4 0, 8 6, 0 6" />
        </svg>
      </button>

      <div className="chat-scroll-slider-rail" />

      <div
        ref={thumbRef}
        className="chat-scroll-slider-thumb"
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerUp}
      />
    </div>
  );
}
