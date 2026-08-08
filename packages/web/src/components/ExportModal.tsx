import { useState, useEffect } from "react";
import { IconDownload, IconFileText, IconCheck, IconX, IconCopy, IconSpinner } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import type { ChatMessage } from "../types";
import { api } from "../api/client";
import { stepsToMessages } from "../transforms/stepsToMessages";
import { exportChatToMarkdown, exportChatToHtml, downloadFile } from "../utils/exportChat";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  cascadeId: string | null;
  initialMessages?: ChatMessage[];
}

export function ExportModal({ isOpen, onClose, title, cascadeId, initialMessages = [] }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && cascadeId) {
      setLoading(true);
      api.getSteps(cascadeId, 0, 100000)
        .then((res) => {
          if (res.steps && res.steps.length > 0) {
            setMessages(stepsToMessages(res.steps));
          } else {
            setMessages(initialMessages);
          }
        })
        .catch(() => {
          setMessages(initialMessages);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, cascadeId, initialMessages]);

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
      <div className="branch-modal-card export-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="branch-modal-header">
          <div className="branch-modal-title">
            <IconDownload size={16} />
            <span>导出与分享全量对话</span>
          </div>
          <button className="artifacts-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="branch-modal-body">
          <div className="export-status-bar">
            {loading ? (
              <span className="export-loading-text">
                <IconSpinner size={14} className="icon-spin" /> 正在拉取后端全量历史记录...
              </span>
            ) : (
              <span>已包含全量 <strong>{messages.length}</strong> 条对话记录</span>
            )}
          </div>

          <div className="export-btn-group">
            <button
              type="button"
              className="export-action-btn primary"
              disabled={loading}
              onClick={handleExportMd}
            >
              <IconFileText size={15} /> 导出为 Markdown 文件 (.md)
            </button>
            <button
              type="button"
              className="export-action-btn secondary"
              disabled={loading}
              onClick={handleExportHtml}
            >
              <IconDownload size={15} /> 导出为 HTML 独立报告 (.html)
            </button>
            <button
              type="button"
              className="export-action-btn copy"
              disabled={loading}
              onClick={handleCopyMd}
            >
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
              <span>{copied ? "已复制全量 Markdown 至剪贴板" : "一键复制全量对话文本"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
