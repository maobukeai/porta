import { useEffect } from "react";
import { IconX } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import type { RevertFileChange } from "../utils/revertFiles";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  files: RevertFileChange[];
  title?: string;
  subtitle?: string;
  confirmText?: string;
  cancelText?: string;
}

function FileTypeBadge({ ext }: { ext: string }) {
  const normalized = ext.toLowerCase();

  if (normalized === "tsx" || normalized === "jsx") {
    return <span className="revert-file-badge react-badge">⚛</span>;
  }
  if (normalized === "ts") {
    return <span className="revert-file-badge ts-badge">TS</span>;
  }
  if (normalized === "js" || normalized === "mjs" || normalized === "cjs") {
    return <span className="revert-file-badge js-badge">JS</span>;
  }
  if (normalized === "css" || normalized === "scss" || normalized === "less") {
    return <span className="revert-file-badge css-badge">CSS</span>;
  }
  if (normalized === "json") {
    return <span className="revert-file-badge json-badge">JSON</span>;
  }
  if (normalized === "py") {
    return <span className="revert-file-badge py-badge">PY</span>;
  }
  if (normalized === "html") {
    return <span className="revert-file-badge html-badge">HTML</span>;
  }
  if (normalized === "md" || normalized === "markdown") {
    return <span className="revert-file-badge md-badge">MD</span>;
  }

  const label = ext.toUpperCase().slice(0, 4) || "FILE";
  return <span className="revert-file-badge generic-badge">{label}</span>;
}

export function RevertConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  files,
  title = "确认撤销",
  subtitle = "确认撤回此步骤后，将对项目文件执行以下变更：",
  confirmText = "确认撤回 ↵",
  cancelText = "取消",
}: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        triggerHaptic("medium");
        onConfirm();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onConfirm]);

  const hasFiles = files.length > 0;

  if (!isOpen) return null;

  return (
    <div className="branch-modal-overlay revert-modal-overlay" onClick={onClose}>
      <div
        className="branch-modal-card revert-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-modal-title"
      >
        <div className="revert-modal-header">
          <div className="revert-modal-title" id="revert-modal-title">
            <span>{title}</span>
          </div>
          <button
            className="revert-modal-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="revert-modal-body">
          <p className="revert-modal-subtitle">{subtitle}</p>

          {hasFiles ? (
            <div className="revert-file-list">
              {files.map((file) => (
                <div key={file.fileName} className="revert-file-row">
                  <div className="revert-file-info">
                    <FileTypeBadge ext={file.ext} />
                    <span className="revert-file-name" title={file.fileUri}>
                      {file.fileName}
                    </span>
                  </div>
                  <div className="revert-file-stats">
                    {file.isCreated ? (
                      <span className="revert-stat-del revert-stat-delete-label">Delete</span>
                    ) : (
                      <>
                        <span className="revert-stat-add">+{file.additions}</span>
                        <span className="revert-stat-del">-{file.deletions}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="revert-empty-notice">
              <span className="revert-empty-icon">ℹ️</span>
              <span>该历史节点之后未修改任何文件，将仅撤回对话记录与推理状态。</span>
            </div>
          )}

          <div className="revert-btn-row">
            <button
              type="button"
              className="revert-btn cancel-btn"
              onClick={() => {
                triggerHaptic("light");
                onClose();
              }}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className="revert-btn confirm-btn"
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
