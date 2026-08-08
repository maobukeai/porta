import type { ChatMessage } from "../types";

export function exportChatToMarkdown(
  title: string,
  messages: ChatMessage[],
): string {
  let md = `# ${title || "对话记录"}\n\n`;
  md += `> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;

  for (const msg of messages) {
    if (msg.role === "user") {
      md += `### 👤 用户\n\n${msg.content}\n\n`;
    } else if (msg.role === "assistant") {
      md += `### 🤖 猫步反重力 AI\n\n${msg.content}\n\n`;
    } else if (msg.role === "system" && msg.content) {
      md += `> ⚙️ **系统步骤**: ${msg.content}\n\n`;
    }
  }

  return md;
}

export function exportChatToHtml(
  title: string,
  messages: ChatMessage[],
): string {
  const mdContent = exportChatToMarkdown(title, messages);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title || "对话记录"}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #090A0F; color: #F3F4F6; }
    h1 { color: #10A37F; border-bottom: 1px solid #2D3748; padding-bottom: 12px; }
    h3 { margin-top: 24px; color: #60A5FA; }
    blockquote { border-left: 4px solid #10A37F; padding-left: 12px; color: #A0AEC0; margin: 16px 0; }
    pre { background: #171922; padding: 14px; border-radius: 8px; overflow-x: auto; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <pre>${mdContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
}

export function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
