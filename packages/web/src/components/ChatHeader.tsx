import { IconMenu, IconFolder, IconGemini, IconChevron, IconPlus, IconGear } from "./Icons";
import { triggerHaptic } from "../utils/haptics";

interface Props {
  title: string;
  projectName?: string;
  onMenuToggle?: () => void;
  onQuickSwitch?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
}

export function ChatHeader({
  title,
  projectName,
  onMenuToggle,
  onQuickSwitch,
  onNewChat,
  onOpenSettings,
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
        onClick={() => {
          triggerHaptic("light");
          if (onQuickSwitch) {
            onQuickSwitch();
          } else {
            document
              .querySelector(".chat-area")
              ?.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
        title="点击快速切换会话"
      >
        <span className="main-header-badge" title="Gemini">
          <IconGemini size={14} />
        </span>
        <span className="main-header-title">{title}</span>
        <IconChevron size={11} className="main-header-quick-chevron" />
      </div>

      <div className="main-header-actions">
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

