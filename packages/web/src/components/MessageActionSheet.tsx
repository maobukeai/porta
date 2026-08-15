import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconCopy, IconCheck, IconMessageCircle, IconUndo } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";

interface MessageActionSheetProps {
  open: boolean;
  onClose: () => void;
  messageText: string;
  media?: unknown[];
  isUserMessage: boolean;
  stepIndex?: number;
  onQuote?: (text: string) => void;
  onRevert?: (stepIndex: number, editText?: string, editMedia?: unknown[]) => void;
  onOpenRevertConfirm?: (stepIndex: number, editText?: string, editMedia?: unknown[]) => void;
}

export function MessageActionSheet({
  open,
  onClose,
  messageText,
  media,
  isUserMessage,
  stepIndex,
  onQuote,
  onRevert,
  onOpenRevertConfirm,
}: MessageActionSheetProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = () => {
    triggerHaptic("light");
    void copyText(messageText).then((success) => {
      if (success) {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          onClose();
        }, 800);
      }
    });
  };

  const handleQuote = () => {
    triggerHaptic("light");
    if (onQuote) {
      onQuote(messageText);
    }
    onClose();
  };

  const handleTTS = () => {
    triggerHaptic("medium");
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("当前浏览器不支持语音朗读");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel(); // Stop any previous speech
    const utterance = new SpeechSynthesisUtterance(messageText);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleRevert = () => {
    triggerHaptic("medium");
    if (stepIndex !== undefined) {
      if (onOpenRevertConfirm) {
        onOpenRevertConfirm(stepIndex, messageText, media);
      } else if (onRevert) {
        onRevert(stepIndex, messageText, media);
      }
    }
    onClose();
  };

  return createPortal(
    <div
      className="action-sheet-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        animation: "fadeIn 0.15s ease-out",
      }}
    >
      <div
        className="action-sheet-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--bg-secondary, #1e1e24)",
          borderTopLeftRadius: "16px",
          borderTopRightRadius: "16px",
          paddingTop: "16px",
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(16px, env(safe-area-inset-right))",
          paddingBottom: "max(20px, env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
          animation: "slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "4px",
            borderRadius: "2px",
            backgroundColor: "var(--border-color, rgba(255,255,255,0.2))",
            margin: "0 auto 8px auto",
          }}
        />

        <button
          className="action-sheet-item"
          onClick={handleCopy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "10px",
            backgroundColor: "var(--bg-tertiary, rgba(255,255,255,0.05))",
            color: "var(--text-primary, #fff)",
            border: "none",
            fontSize: "15px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
          <span>{copied ? "已复制文本" : "复制消息文本"}</span>
        </button>

        {onQuote && (
          <button
            className="action-sheet-item"
            onClick={handleQuote}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              backgroundColor: "var(--bg-tertiary, rgba(255,255,255,0.05))",
              color: "var(--text-primary, #fff)",
              border: "none",
              fontSize: "15px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <IconMessageCircle size={18} />
            <span>引用为提示词</span>
          </button>
        )}

        <button
          className="action-sheet-item"
          onClick={handleTTS}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "10px",
            backgroundColor: "var(--bg-tertiary, rgba(255,255,255,0.05))",
            color: "var(--text-primary, #fff)",
            border: "none",
            fontSize: "15px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "18px" }}>{isSpeaking ? "⏹️" : "🔊"}</span>
          <span>{isSpeaking ? "停止语音朗读" : "语音朗读消息"}</span>
        </button>

        {isUserMessage && onRevert && stepIndex !== undefined && (
          <button
            className="action-sheet-item"
            onClick={handleRevert}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              color: "#f87171",
              border: "none",
              fontSize: "15px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <IconUndo size={18} />
            <span>重新编辑 / 回退到此步</span>
          </button>
        )}

        <button
          className="action-sheet-cancel"
          onClick={onClose}
          style={{
            marginTop: "6px",
            padding: "14px",
            borderRadius: "10px",
            backgroundColor: "transparent",
            color: "var(--text-secondary, #999)",
            border: "1px solid var(--border-color, rgba(255,255,255,0.1))",
            fontSize: "15px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          取消
        </button>
      </div>
    </div>,
    document.body,
  );
}
