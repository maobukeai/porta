import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconKeyboard, IconX } from "./Icons";

interface ShortcutEntry {
  keys: string[];
  desc: string;
}

const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: ["Ctrl", "K"], desc: "打开命令面板（或 Ctrl+Shift+P）" },
  { keys: ["Ctrl", "F"], desc: "在当前对话中查找内容" },
  { keys: ["Ctrl", "N"], desc: "新建对话" },
  { keys: ["Ctrl", "B"], desc: "展开 / 收起侧边栏" },
  { keys: ["Ctrl", "Alt", "B"], desc: "切换右侧面板" },
  { keys: ["Ctrl", "`"], desc: "切换终端面板" },
  { keys: ["Ctrl", "E"], desc: "导出当前对话" },
  { keys: ["Esc"], desc: "逐层关闭当前弹层" },
  { keys: ["?"], desc: "显示本快捷键帮助" },
];

const DESKTOP_INTERACTIONS: ShortcutEntry[] = [
  { keys: ["右键消息"], desc: "复制 / 引用 / 撤回 / 朗读" },
  { keys: ["右键会话"], desc: "置顶 / 归档 / 重命名 / 删除" },
  { keys: ["拖动面板边缘"], desc: "调整侧面板宽度（双击重置）" },
  { keys: ["双击标题"], desc: "回到对话顶部" },
  { keys: ["Enter / F3"], desc: "查找条内跳转下一个匹配（Shift 为上一个）" },
  { keys: ["↑"], desc: "空输入框中召回上一条已发送消息（↓ 返回）" },
];

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-desc">{entry.desc}</span>
      <span className="shortcut-keys">
        {entry.keys.map((k) => (
          <kbd key={k} className="shortcuts-kbd">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutsHelpOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="shortcuts-overlay" onMouseDown={onClose}>
      <div
        className="shortcuts-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IconKeyboard size={16} />
            <span className="shortcuts-title">键盘快捷键</span>
          </div>
          <button
            type="button"
            className="shortcuts-close-btn"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <IconX size={14} />
          </button>
        </div>
        <div className="shortcuts-body">
          <div className="shortcuts-section-title">全局</div>
          <div className="shortcuts-grid">
            {GLOBAL_SHORTCUTS.map((entry) => (
              <ShortcutRow key={entry.desc} entry={entry} />
            ))}
          </div>
          <div className="shortcuts-section-title">桌面交互</div>
          <div className="shortcuts-grid">
            {DESKTOP_INTERACTIONS.map((entry) => (
              <ShortcutRow key={entry.desc} entry={entry} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
