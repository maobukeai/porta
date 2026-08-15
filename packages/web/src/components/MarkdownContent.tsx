import { memo, useState, useMemo } from "react";
import { IconCopy, IconCheck, IconDownload, IconMaximize } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { copyText } from "../utils/clipboard";
import { DiagramModal } from "./DiagramModal";

interface Segment {
  type: "html" | "pre" | "table";
  content: string; // for html: raw html string; for pre: code text; for table: table text / csv
  rawHtml: string; // original html for re-rendering
}

function splitSegments(html: string): Segment[] {
  const segments: Segment[] = [];
  // Match <pre>...</pre> and <table>...</table>
  const blockRegex = /(?:<pre[^>]*>[\s\S]*?<\/pre>)|(?:<table[^>]*>[\s\S]*?<\/table>)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const htmlBefore = html.slice(lastIndex, match.index);
      if (htmlBefore.trim()) {
        segments.push({
          type: "html",
          content: htmlBefore,
          rawHtml: htmlBefore,
        });
      }
    }

    const matchedHtml = match[0];
    if (matchedHtml.toLowerCase().startsWith("<pre")) {
      const textContent = matchedHtml
        .replace(/^<pre[^>]*>/i, "")
        .replace(/<\/pre>$/i, "")
        .replace(/<[^>]*>/g, "");
      segments.push({
        type: "pre",
        content: textContent,
        rawHtml: matchedHtml,
      });
    } else {
      // Table block
      const textContent = matchedHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      segments.push({
        type: "table",
        content: textContent,
        rawHtml: matchedHtml,
      });
    }

    lastIndex = match.index + matchedHtml.length;
  }

  if (lastIndex < html.length) {
    const trailing = html.slice(lastIndex);
    if (trailing.trim()) {
      segments.push({ type: "html", content: trailing, rawHtml: trailing });
    }
  }

  return segments;
}

/** Extract programming language from class or tag in html */
function extractLanguage(html: string): string {
  const match = html.match(/class=["'][^"']*language-([a-zA-Z0-9_-]+)[^"']*["']/i);
  if (match && match[1]) {
    const lang = match[1].toLowerCase();
    if (lang === "typescript" || lang === "ts") return "TS";
    if (lang === "javascript" || lang === "js") return "JS";
    if (lang === "tsx") return "TSX";
    if (lang === "jsx") return "JSX";
    if (lang === "python" || lang === "py") return "PY";
    if (lang === "markdown" || lang === "md") return "MD";
    if (lang === "bash" || lang === "sh" || lang === "shell") return "BASH";
    return lang.toUpperCase().slice(0, 8);
  }
  return "CODE";
}

function tableHtmlToCsv(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = Array.from(doc.querySelectorAll("tr"));
    return rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        return cells
          .map((cell) => {
            let text = cell.textContent?.trim() || "";
            text = text.replace(/"/g, '""');
            if (text.includes(",") || text.includes("\n") || text.includes('"')) {
              text = `"${text}"`;
            }
            return text;
          })
          .join(",");
      })
      .join("\n");
  } catch {
    return html.replace(/<[^>]*>/g, " ");
  }
}

function tableHtmlToMarkdown(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = Array.from(doc.querySelectorAll("tr"));
    if (rows.length === 0) return "";
    const lines: string[] = [];
    rows.forEach((row, idx) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      const line = `| ${cells.map((c) => c.textContent?.trim() || "").join(" | ")} |`;
      lines.push(line);
      if (idx === 0) {
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      }
    });
    return lines.join("\n");
  } catch {
    return html.replace(/<[^>]*>/g, " ");
  }
}

function downloadCsvFile(content: string, filename = "table.csv") {
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Table Card with Copy, Download CSV & Maximize/Zoom */
function TableCard({ rawHtml }: { rawHtml: string }) {
  const [copied, setCopied] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("success");
    const md = tableHtmlToMarkdown(rawHtml);
    void copyText(md).then((success) => {
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("light");
    const csv = tableHtmlToCsv(rawHtml);
    downloadCsvFile(csv, `zcode-table-${Date.now()}.csv`);
  };

  const handleZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("medium");
    setZoomOpen(true);
  };

  return (
    <div className="zcode-table-card">
      <div className="zcode-table-actions-header">
        <button
          className={`zcode-table-action-btn ${copied ? "copied" : ""}`}
          title="复制表格 (Markdown)"
          onClick={handleCopy}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </button>
        <button
          className="zcode-table-action-btn"
          title="导出表格为 CSV"
          onClick={handleDownload}
        >
          <IconDownload size={13} />
        </button>
        <button
          className="zcode-table-action-btn"
          title="全屏缩放查看表格"
          onClick={handleZoom}
        >
          <IconMaximize size={13} />
        </button>
      </div>

      <div
        className="zcode-table-inner"
        dangerouslySetInnerHTML={{ __html: rawHtml }}
      />

      {zoomOpen && (
        <DiagramModal
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          title="表格全屏预览"
          code={tableHtmlToMarkdown(rawHtml)}
          rawHtml={rawHtml}
        />
      )}
    </div>
  );
}

/** Copy & Zoom header for code blocks */
function CodeHeader({
  text,
  lang,
  rawHtml,
}: {
  text: string;
  lang: string;
  rawHtml: string;
}) {
  const [copied, setCopied] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <div className="code-block-header">
      <span className="code-lang-tag">{lang}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <button
          className="code-copy-btn"
          title="全屏/手势缩放查看"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic("medium");
            setZoomOpen(true);
          }}
        >
          <IconMaximize size={12} />
        </button>
        <button
          className={`code-copy-btn ${copied ? "copied" : ""}`}
          title="复制代码"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic("success");
            void copyText(text).then((success) => {
              if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            });
          }}
        >
          {copied ? (
            <>
              <IconCheck size={12} />
              <span>已复制</span>
            </>
          ) : (
            <>
              <IconCopy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {zoomOpen && (
        <DiagramModal
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          title={`${lang} 代码与结构图预览`}
          code={text}
          rawHtml={rawHtml}
        />
      )}
    </div>
  );
}

interface MarkdownContentProps {
  html: string;
  /** If true, skip copy buttons on pre blocks (e.g. inside step cards) */
  skipCopyButtons?: boolean;
}

/**
 * Renders markdown HTML with React-managed copy/download buttons on code blocks & tables.
 */
export const MarkdownContent = memo(function MarkdownContent({
  html,
  skipCopyButtons = false,
}: MarkdownContentProps) {
  const segments = useMemo(() => splitSegments(html), [html]);

  // Fast path: no <pre> or <table> blocks, just render as-is
  if (segments.length <= 1 && segments[0]?.type === "html") {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <div className="zcode-markdown-flow">
      {segments.map((seg, i) => {
        if (seg.type === "html") {
          return (
            <div key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />
          );
        }
        if (seg.type === "table") {
          return <TableCard key={i} rawHtml={seg.rawHtml} />;
        }
        // Pre block: render with code header
        return (
          <div key={i} className="code-block-wrapper" style={{ position: "relative" }}>
            {!skipCopyButtons && (
              <CodeHeader
                text={seg.content}
                lang={extractLanguage(seg.rawHtml)}
                rawHtml={seg.rawHtml}
              />
            )}
            <pre
              dangerouslySetInnerHTML={{
                __html: seg.rawHtml.replace(/^<pre[^>]*>|<\/pre>$/gi, ""),
              }}
            />
          </div>
        );
      })}
    </div>
  );
});
