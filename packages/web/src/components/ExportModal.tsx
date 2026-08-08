import { useState } from "react";
import { IconDownload, IconFileText, IconCheck, IconX, IconCopy } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import type { ChatMessage } from "../types";
import { exportChatToMarkdown, exportChatToHtml, downloadFile } from "../utils/exportChat";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  messages: ChatMessage[];
}

export function ExportModal({ isOpen, onClose, title, messages }: Props) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleExportMd = () => {
    triggerHaptic("medium");
    const md = exportChatToMarkdown(title, messages);
    downloadFile(`${title || "chat"}_${Date.now()}.md`, md, "text/markdown");
    onClose();
  };

  const handleExportHtml = () => {
    triggerHaptic("medium");
    const html = exportChatToHtml(title, messages);
    downloadFile(`${title || "chat"}_${Date.now()}.html`, html, "text/html");
    onClose();
  };

  const handleCopyMd = () => {
    triggerHaptic("light");
    const md = exportChatToMarkdown(title, messages);
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <div className="branch-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="branch-modal-header">
          <div className="branch-modal-title">
            <IconDownload size={16} />
            <span>导出与分享对话</span>
          </div>
          <button onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="branch-modal-body">
          <div className="branch-sync-bar">
            <span>当前包含 <strong>{messages.length}</strong> 条消息记录</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="vscode-main-commit-btn" onClick={handleExportMd}>
              <IconFileText size={14} /> 导出为 Markdown 文件 (.md)
            </button>
            <button className="vscode-main-commit-btn" onClick={handleExportHtml}>
              <IconDownload size={14} /> 导出为 HTML 独立报告 (.html)
            </button>
            <button className="git-btn secondary" onClick={handleCopyMd}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? "已复制完整 Markdown 至剪贴板" : "一键复制完整对话文本"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
