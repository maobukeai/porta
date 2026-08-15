import { useState, useRef, useEffect } from "react";
import {
  IconMenu,
  IconFolder,
  IconChevron,
  IconPlus,
  IconGear,
  IconGitBranch,
  IconDownload,
  IconTerminalSquare,
  IconPanelRight,
  IconMoreHorizontal,
  IconPencil,
  IconPin,
  IconArchive,
  IconCopy,
  IconTrash,
  IconX,
  IconCheck,
} from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  title: string;
  projectName?: string;
  conversationId?: string;
  gitBranch?: string;
  gitChangesCount?: number;
  onMenuToggle?: () => void;
  onQuickSwitch?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onToggleArtifacts?: () => void;
  onOpenExport?: () => void;
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;
  artifactsCount?: number;
  isArtifactsOpen?: boolean;
  onOpenReview?: () => void;
  onOpenGit?: () => void;
  onRename?: (id: string, newTitle: string) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  isPinned?: boolean;
  isArchived?: boolean;
}

export function ChatHeader({
  title,
  projectName,
  conversationId,
  gitBranch,
  gitChangesCount = 0,
  onMenuToggle,
  onQuickSwitch,
  onNewChat,
  onOpenSettings,
  onToggleArtifacts,
  onOpenExport,
  onToggleTerminal,
  isTerminalOpen = false,
  artifactsCount = 0,
  isArtifactsOpen = false,
  onOpenReview,
  onOpenGit,
  onRename,
  onDelete,
  onTogglePin,
  onToggleArchive,
  isPinned = false,
  isArchived = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copySubmenuOpen, setCopySubmenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const menuContainerRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
        setCopySubmenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleCopy = async (text: string, label: string) => {
    triggerHaptic("light");
    const ok = await copyText(text);
    if (ok) {
      showToast(`已复制${label}`);
    }
    setMenuOpen(false);
    setCopySubmenuOpen(false);
  };

  return (
    <div className="main-header">
      <div className="main-header-left">
        {onMenuToggle && (
          <button
            className="mobile-menu-btn"
            onClick={() => {
              triggerHaptic("medium");
              onMenuToggle();
            }}
            title="打开侧边栏 (滑动手势)"
          >
            <IconMenu size={18} />
          </button>
        )}

        {projectName && (
          <button
            className="main-header-project-btn"
            onClick={() => {
              triggerHaptic("light");
              onQuickSwitch?.();
            }}
            title="切换工作区"
            aria-label="切换工作区"
          >
            <IconFolder size={12} />
            <span className="main-header-project-name">{projectName}</span>
          </button>
        )}

        <div
          className="main-header-title-wrap"
          onClick={(e) => {
            triggerHaptic("light");
            if (e.detail === 2) {
              // Double-tap: quick scroll to top
              document
                .querySelector(".chat-area")
                ?.scrollTo({ top: 0, behavior: "smooth" });
            } else if (onQuickSwitch) {
              onQuickSwitch();
            } else {
              document
                .querySelector(".chat-area")
                ?.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          title="点击切换会话 / 双击滚到顶部"
        >
          <span className="main-header-title">{title}</span>
          <IconChevron size={11} className="main-header-quick-chevron" />
        </div>

        {/* Three Dots Menu Button */}
        {conversationId && (
          <div className="main-header-menu-container" ref={menuContainerRef}>
            <button
              className={`main-header-dots-btn ${menuOpen ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic("light");
                setMenuOpen((v) => !v);
              }}
              title="对话选项"
              aria-label="更多操作"
            >
              <IconMoreHorizontal size={15} />
            </button>

            {menuOpen && (
              <div className="zcode-header-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                {/* 1. Rename */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setTempTitle(title);
                    setIsRenaming(true);
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconPencil size={13} className="zcode-dropdown-icon" />
                    <span>重命名</span>
                  </div>
                </button>

                {/* 2. Pin / Unpin */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    triggerHaptic("medium");
                    onTogglePin?.(conversationId);
                    showToast(isPinned ? "已取消置顶" : "已置顶对话");
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconPin size={13} className="zcode-dropdown-icon" />
                    <span>{isPinned ? "取消置顶" : "置顶"}</span>
                  </div>
                </button>

                {/* 3. Archive / Unarchive */}
                <button
                  className="zcode-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    triggerHaptic("medium");
                    onToggleArchive?.(conversationId);
                    showToast(isArchived ? "已取消归档" : "已归档对话");
                  }}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconArchive size={13} className="zcode-dropdown-icon" />
                    <span>{isArchived ? "取消归档" : "归档"}</span>
                  </div>
                </button>

                <div className="zcode-dropdown-divider" />

                {/* 4. Copy Submenu */}
                <div
                  className="zcode-dropdown-item has-submenu"
                  onMouseEnter={() => setCopySubmenuOpen(true)}
                  onMouseLeave={() => setCopySubmenuOpen(false)}
                  onClick={() => setCopySubmenuOpen((v) => !v)}
                >
                  <div className="zcode-dropdown-item-left">
                    <IconCopy size={13} className="zcode-dropdown-icon" />
                    <span>复制</span>
                  </div>
                  <IconChevron size={11} className="zcode-dropdown-arrow" />

                  {copySubmenuOpen && (
                    <div className="zcode-dropdown-submenu">
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(title, "对话名称");
                        }}
                      >
                        <span>复制对话名称</span>
                      </button>
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(conversationId, "对话 ID");
                        }}
                      >
                        <span>复制对话 ID</span>
                      </button>
                      <button
                        className="zcode-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(projectName || "任务", "项目名称");
                        }}
                      >
                        <span>复制项目名称</span>
                      </button>
                    </div>
                  )}
                </div>

                {onDelete && (
                  <>
                    <div className="zcode-dropdown-divider" />
                    <button
                      className="zcode-dropdown-item danger"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowDeleteConfirm(true);
                      }}
                    >
                      <div className="zcode-dropdown-item-left">
                        <IconTrash size={13} className="zcode-dropdown-icon" />
                        <span>删除对话</span>
                      </div>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Floating Toast */}
            {toastMessage && (
              <div className="main-header-toast">
                <IconCheck size={12} />
                <span>{toastMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="main-header-actions">
        {gitBranch && (
          <button
            className="main-header-git-pill"
            onClick={() => {
              triggerHaptic("light");
              if (onOpenGit) {
                onOpenGit();
              } else if (onOpenReview) {
                onOpenReview();
              } else if (onToggleArtifacts) {
                onToggleArtifacts();
              }
            }}
            title={`Git 分支: ${gitBranch}${gitChangesCount > 0 ? ` (${gitChangesCount} 文件更改)` : ""} (点击打开 Git 控制台)`}
          >
            <IconGitBranch size={13} className="header-git-icon" />
            <span className="header-git-branch-name">{gitBranch}</span>
            {gitChangesCount > 0 && (
              <span className="header-git-changes-badge">{gitChangesCount}</span>
            )}
          </button>
        )}

        {onToggleTerminal && (
          <button
            className={`header-icon-btn zcode-header-tool-btn ${isTerminalOpen ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("medium");
              onToggleTerminal();
            }}
            title="切换终端 (Ctrl+`)"
            aria-label="切换终端"
          >
            <IconTerminalSquare size={16} />
          </button>
        )}

        {onToggleArtifacts && (
          <button
            className={`header-icon-btn zcode-header-tool-btn header-artifacts-btn ${isArtifactsOpen ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("medium");
              onToggleArtifacts();
            }}
            title="切换面板 (Ctrl+Alt+B)"
            aria-label="切换面板"
          >
            <IconPanelRight size={16} />
            {artifactsCount > 0 && (
              <span className="header-artifacts-badge">{artifactsCount}</span>
            )}
          </button>
        )}

        {onOpenExport && (
          <button
            className="header-icon-btn desktop-only-action"
            onClick={() => {
              triggerHaptic("medium");
              onOpenExport();
            }}
            title="导出与分享对话"
            aria-label="导出与分享对话"
          >
            <IconDownload size={15} />
          </button>
        )}

        {onNewChat && (
          <button
            className="header-icon-btn header-new-chat-btn"
            onClick={() => {
              triggerHaptic("medium");
              onNewChat();
            }}
            title="新建对话"
            aria-label="新建对话"
          >
            <IconPlus size={15} />
          </button>
        )}

        {onOpenSettings && (
          <button
            className="header-icon-btn header-settings-btn"
            onClick={() => {
              triggerHaptic("light");
              onOpenSettings();
            }}
            title="系统设置"
            aria-label="系统设置"
          >
            <IconGear size={15} />
          </button>
        )}
      </div>

      {/* Rename Modal (Matches Screenshot 1:1) */}
      {isRenaming && (
        <div className="zcode-rename-overlay" onClick={() => setIsRenaming(false)}>
          <div
            className="zcode-rename-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="zcode-rename-header">
              <span className="zcode-rename-title">重命名任务</span>
              <button
                className="zcode-rename-close"
                onClick={() => setIsRenaming(false)}
                title="关闭"
              >
                <IconX size={14} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (tempTitle.trim() && conversationId) {
                  onRename?.(conversationId, tempTitle.trim());
                  showToast("已更新任务名称");
                  setIsRenaming(false);
                }
              }}
            >
              <input
                type="text"
                className="zcode-rename-input"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                autoFocus
                placeholder="任务名称"
              />
              <div className="zcode-rename-actions">
                <button
                  type="button"
                  className="zcode-rename-btn-cancel"
                  onClick={() => setIsRenaming(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="zcode-rename-btn-confirm"
                  disabled={!tempTitle.trim()}
                >
                  确认
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          if (conversationId) {
            onDelete?.(conversationId);
          }
        }}
        title="删除对话"
        message={`确定要删除对话 "${title}" 吗？`}
        subMessage="删除后该对话的历史记录与执行轨迹将被永久清理。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
      />
    </div>
  );
}

