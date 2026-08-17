import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Render a divider above this item */
  dividerBefore?: boolean;
  onSelect?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Desktop-only: suppresses the menu on touch devices so mobile long-press keeps working. */
export function isContextMenuSupported(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Flip the menu when it would overflow the viewport edges
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = state.x;
    let top = state.y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPos({ left, top });
  }, [state.x, state.y]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Any scroll (capture phase, including inner panels) dismisses the menu
    const handleScroll = () => onClose();
    const handleResize = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="zcode-header-dropdown-menu porta-context-menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) => (
        <div key={item.key}>
          {item.dividerBefore && <div className="zcode-dropdown-divider" />}
          <button
            type="button"
            className={`zcode-dropdown-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              if (!item.disabled) item.onSelect?.();
            }}
          >
            <div className="zcode-dropdown-item-left">
              {item.icon}
              <span>{item.label}</span>
            </div>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Desktop right-click context menu.
 *
 * Usage:
 *   const ctx = useContextMenu();
 *   <div onContextMenu={(e) => ctx.openFromMouse(e, items)} />
 *   {ctx.menu}
 *
 * `openFromMouse` is a no-op on touch devices.
 */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);

  const close = useCallback(() => setState(null), []);

  const openFromMouse = useCallback(
    (
      e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void },
      items: ContextMenuItem[],
    ) => {
      if (!isContextMenuSupported()) return;
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, items });
    },
    [],
  );

  const menu = state ? <ContextMenu state={state} onClose={close} /> : null;

  return { openFromMouse, close, menu } as const;
}
