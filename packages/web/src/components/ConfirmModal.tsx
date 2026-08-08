import { IconAlertTriangle, IconX } from "./Icons";
import { triggerHaptic } from "../utils/haptics";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  subMessage?: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "确认提示",
  message,
  subMessage,
  confirmText = "确认",
  cancelText = "取消",
  type = "warning",
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <div
        className="branch-modal-card confirm-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="branch-modal-header">
          <div className="branch-modal-title warning-title">
            <IconAlertTriangle size={18} className="confirm-icon-warning" />
            <span>{title}</span>
          </div>
          <button className="artifacts-close-btn" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="branch-modal-body">
          <div className="confirm-modal-content">
            <p className="confirm-main-text">{message}</p>
            {subMessage && <p className="confirm-sub-text">{subMessage}</p>}
          </div>

          <div className="confirm-btn-row">
            <button
              type="button"
              className="confirm-btn secondary"
              onClick={() => {
                triggerHaptic("light");
                onClose();
              }}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={`confirm-btn primary ${type}`}
              onClick={() => {
                triggerHaptic("medium");
                onConfirm();
                onClose();
              }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
