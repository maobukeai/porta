import { useEffect, useState } from "react";

export interface VisualViewportState {
  height: number;
  offsetTop: number;
  isKeyboardVisible: boolean;
  keyboardHeight: number;
}

/**
 * Custom hook to track window.visualViewport changes.
 * Solves iOS Safari / Android Chrome virtual keyboard layout shifts & overlap.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return {
        height: typeof window !== "undefined" ? window.innerHeight : 0,
        offsetTop: 0,
        isKeyboardVisible: false,
        keyboardHeight: 0,
      };
    }
    const vv = window.visualViewport;
    const kbHeight = Math.max(0, window.innerHeight - vv.height);
    return {
      height: vv.height,
      offsetTop: vv.offsetTop,
      isKeyboardVisible: kbHeight > 150,
      keyboardHeight: kbHeight,
    };
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;

    const handleResizeOrScroll = () => {
      const kbHeight = Math.max(0, window.innerHeight - vv.height);
      const newState: VisualViewportState = {
        height: vv.height,
        offsetTop: vv.offsetTop,
        isKeyboardVisible: kbHeight > 150,
        keyboardHeight: kbHeight,
      };

      // Set CSS variables on root element for responsive CSS layouts
      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${vv.height}px`,
      );
      document.documentElement.style.setProperty(
        "--visual-viewport-offset-top",
        `${vv.offsetTop}px`,
      );
      document.documentElement.style.setProperty(
        "--keyboard-height",
        `${kbHeight}px`,
      );

      if (kbHeight > 150) {
        document.body.classList.add("keyboard-visible");
      } else {
        document.body.classList.remove("keyboard-visible");
      }

      setState(newState);
    };

    // Initial sync
    handleResizeOrScroll();

    vv.addEventListener("resize", handleResizeOrScroll);
    vv.addEventListener("scroll", handleResizeOrScroll);

    return () => {
      vv.removeEventListener("resize", handleResizeOrScroll);
      vv.removeEventListener("scroll", handleResizeOrScroll);
    };
  }, []);

  return state;
}
