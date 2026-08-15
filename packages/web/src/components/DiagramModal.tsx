import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconCopy } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";

interface DiagramModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  code: string;
  rawHtml?: string;
}

export function DiagramModal({
  open,
  onClose,
  title = "图表与代码缩放预览",
  code,
  rawHtml,
}: DiagramModalProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const initialPinchDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef(1);
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }, [open]);

  if (!open) return null;

  const handleCopy = () => {
    triggerHaptic("success");
    void copyText(code).then((success) => {
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      // Pinch gesture
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      initialPinchDistRef.current = dist;
      initialScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      // Pan gesture
      lastTouchPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const factor = dist / initialPinchDistRef.current;
      const newScale = Math.min(Math.max(0.6, initialScaleRef.current * factor), 4);
      setScale(newScale);
    } else if (e.touches.length === 1 && lastTouchPosRef.current && scale > 1) {
      const dx = e.touches[0].clientX - lastTouchPosRef.current.x;
      const dy = e.touches[0].clientY - lastTouchPosRef.current.y;
      lastTouchPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const handleTouchEnd = () => {
    initialPinchDistRef.current = null;
    lastTouchPosRef.current = null;
  };

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.3, 4));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.3, 0.6));
  const handleResetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  return createPortal(
    <div
      className="diagram-modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header toolbar */}
      <div
        className="diagram-modal-header"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
          backgroundColor: "rgba(20, 20, 25, 0.9)",
          color: "#fff",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "15px" }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={handleZoomOut}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            -
          </button>
          <span style={{ fontSize: "12px", minWidth: "40px", textAlign: "center" }}>
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            +
          </button>
          <button
            onClick={handleResetZoom}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#aaa",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            重置
          </button>
          <button
            onClick={handleCopy}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: "var(--accent-color, #3b82f6)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.2)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main zoomable content area */}
      <div
        className="diagram-modal-body"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          touchAction: "none",
        }}
      >
        <div
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: initialPinchDistRef.current ? "none" : "transform 0.1s ease-out",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          {rawHtml ? (
            <div
              dangerouslySetInnerHTML={{ __html: rawHtml }}
              style={{ color: "#e2e8f0", fontFamily: "monospace" }}
            />
          ) : (
            <pre
              style={{
                color: "#e2e8f0",
                backgroundColor: "#1e1e24",
                padding: "16px",
                borderRadius: "8px",
                overflow: "auto",
                fontSize: "13px",
                lineHeight: 1.5,
              }}
            >
              {code}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
