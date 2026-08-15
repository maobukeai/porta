import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React, { useState, useCallback } from "react";
import { ChatScrollSlider } from "../components/ChatScrollSlider";

// Test wrapper that provides a mock scrollable container
function TestScrollContainer({
  scrollHeight = 1000,
  clientHeight = 400,
  scrollTop = 0,
}: {
  scrollHeight?: number;
  clientHeight?: number;
  scrollTop?: number;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        Object.defineProperty(node, "scrollHeight", {
          configurable: true,
          value: scrollHeight,
        });
        Object.defineProperty(node, "clientHeight", {
          configurable: true,
          value: clientHeight,
        });
        Object.defineProperty(node, "scrollTop", {
          configurable: true,
          writable: true,
          value: scrollTop,
        });
      }
      containerRef.current = node;
      setContainerEl(node);
    },
    [scrollHeight, clientHeight, scrollTop],
  );

  return (
    <div style={{ position: "relative", height: clientHeight }}>
      <div ref={setRef} style={{ height: clientHeight, overflowY: "auto" }}>
        <div style={{ height: scrollHeight }} />
      </div>
      {containerEl && <ChatScrollSlider targetRef={containerRef} />}
    </div>
  );
}

describe("ChatScrollSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render when content is not scrollable", () => {
    const { container } = render(
      <TestScrollContainer scrollHeight={400} clientHeight={400} />,
    );

    expect(
      container.querySelector(".chat-scroll-slider-track"),
    ).not.toBeInTheDocument();
  });

  it("renders and becomes visible on scroll when content is scrollable", () => {
    const { container } = render(
      <TestScrollContainer scrollHeight={1200} clientHeight={400} scrollTop={100} />,
    );

    const track = container.querySelector(".chat-scroll-slider-track");
    expect(track).toBeInTheDocument();

    const thumb = container.querySelector(".chat-scroll-slider-thumb");
    expect(thumb).toBeInTheDocument();

    // Trigger scroll event on the scrollable container
    const scrollEl = container.querySelector("div[style*='overflow-y: auto']");
    if (scrollEl) {
      act(() => {
        fireEvent.scroll(scrollEl);
      });
    }

    expect(track).toHaveClass("visible");

    // After fade timeout, it should become hidden
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(track).not.toHaveClass("visible");
  });

  it("scrolls to top when clicking the top arrow button", () => {
    const { container } = render(
      <TestScrollContainer scrollHeight={1200} clientHeight={400} scrollTop={300} />,
    );

    const scrollEl = container.querySelector(
      "div[style*='overflow-y: auto']",
    ) as HTMLElement;
    const scrollToMock = vi.fn();
    if (scrollEl) {
      scrollEl.scrollTo = scrollToMock;
    }

    const arrowBtn = container.querySelector(".chat-scroll-slider-arrow");
    expect(arrowBtn).toBeInTheDocument();

    if (arrowBtn) {
      act(() => {
        fireEvent.click(arrowBtn);
      });
    }

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("keeps slider visible on mouse hover", () => {
    const { container } = render(
      <TestScrollContainer scrollHeight={1200} clientHeight={400} scrollTop={50} />,
    );

    const track = container.querySelector(
      ".chat-scroll-slider-track",
    ) as HTMLElement;
    expect(track).toBeInTheDocument();

    act(() => {
      fireEvent.mouseEnter(track);
    });

    expect(track).toHaveClass("visible");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Still visible because mouse is hovering
    expect(track).toHaveClass("visible");

    act(() => {
      fireEvent.mouseLeave(track);
      vi.advanceTimersByTime(1500);
    });

    // Fades out after mouse leaves
    expect(track).not.toHaveClass("visible");
  });
});
