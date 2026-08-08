import { IconMenu, IconFolder, IconGemini, IconChevron, IconPlus, IconGear, IconBox, IconGitBranch } from "./Icons";
import { triggerHaptic } from "../utils/haptics";

interface Props {
  title: string;
  projectName?: string;
  gitBranch?: string;
  gitChangesCount?: number;
  onMenuToggle?: () => void;
  onQuickSwitch?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onToggleArtifacts?: () => void;
  artifactsCount?: number;
  isArtifactsOpen?: boolean;
}

export function ChatHeader({
  title,
  projectName,
  gitBranch,
  gitChangesCount = 0,
  onMenuToggle,
  onQuickSwitch,
  onNewChat,
  onOpenSettings,
  onToggleArtifacts,
  artifactsCount = 0,
  isArtifactsOpen = false,
}: Props) {
  return (
    <div className="main-header">
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
        <span className="main-header-badge" title="Gemini">
          <IconGemini size={14} />
        </span>
        <span className="main-header-title">{title}</span>
        <IconChevron size={11} className="main-header-quick-chevron" />
      </div>

      <div className="main-header-actions">
        {gitBranch && onToggleArtifacts && (
          <button
            className="main-header-git-pill"
            onClick={() => {
              triggerHaptic("light");
              onToggleArtifacts();
            }}
            title={`Git 分支: ${gitBranch}${gitChangesCount > 0 ? ` (${gitChangesCount} 文件更改)` : ""}`}
          >
            <IconGitBranch size={12} />
            <span className="header-git-branch-name">{gitBranch}</span>
            {gitChangesCount > 0 && (
              <span className="header-git-changes-badge">{gitChangesCount}</span>
            )}
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

        {onToggleArtifacts && (
          <button
            className={`header-icon-btn header-artifacts-btn ${isArtifactsOpen ? "active" : ""}`}
            onClick={() => {
              triggerHaptic("medium");
              onToggleArtifacts();
            }}
            title="Artifacts 交付物控制台"
            aria-label="Artifacts 交付物控制台"
          >
            <IconBox size={15} />
            {artifactsCount > 0 && (
              <span className="header-artifacts-badge">{artifactsCount}</span>
            )}
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
    </div>
  );
}

