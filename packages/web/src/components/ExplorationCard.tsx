import { useState } from "react";
import type { ExplorationGroupData, ToolCallDisplayItem } from "../types";
import { IconSearch, IconChevron, IconFolder, IconFile } from "./Icons";

interface Props {
  exploration: ExplorationGroupData;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
}

function getFileBadge(ext?: string) {
  const e = (ext || "").toLowerCase();
  switch (e) {
    case "ts":
    case "tsx":
      return <span className="file-badge badge-ts">TS</span>;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <span className="file-badge badge-js">JS</span>;
    case "json":
      return <span className="file-badge badge-json">{"{}"}</span>;
    case "css":
    case "scss":
    case "less":
      return <span className="file-badge badge-css">#</span>;
    case "html":
    case "htm":
      return <span className="file-badge badge-html">{"<>"}</span>;
    case "md":
      return <span className="file-badge badge-md">MD</span>;
    case "py":
      return <span className="file-badge badge-py">PY</span>;
    case "search":
      return <IconSearch size={12} className="file-icon-search" />;
    case "folder":
      return <IconFolder size={12} className="file-icon-folder" />;
    default:
      return <IconFile size={12} className="file-icon-generic" />;
  }
}

export function ExplorationCard({ exploration, onOpenFile }: Props) {
  const [expanded, setExpanded] = useState(false);

  const items = exploration.items || [];
  const fileCount = items.length;
  const title = exploration.title || `探索 · ${fileCount} 文件`;

  const handleItemClick = (item: ToolCallDisplayItem) => {
    if (onOpenFile) {
      let fullPath = item.path || item.name;
      if (item.path && item.name) {
        if (item.path.endsWith("/")) {
          fullPath = `${item.path}${item.name}`;
        } else if (!item.path.endsWith(item.name)) {
          fullPath = `${item.path}/${item.name}`;
        }
      }
      onOpenFile({
        name: item.name,
        path: fullPath,
        ext: item.ext,
        range: item.range,
      });
    }
  };

  return (
    <div className="zcode-exploration-card">
      {/* Header */}
      <button
        className="zcode-exploration-header"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
        aria-expanded={expanded}
      >
        <div className="zcode-exploration-header-left">
          <IconSearch size={13} className="zcode-exploration-icon" />
          <span className="zcode-exploration-title">{title}</span>
          <span className="zcode-exploration-toggle-icon">
            <IconChevron size={11} className={expanded ? "expanded" : ""} />
          </span>
        </div>
      </button>

      {/* Tree items */}
      {expanded && items.length > 0 && (
        <div className="zcode-exploration-tree">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="zcode-exploration-item"
              onClick={() => handleItemClick(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleItemClick(item);
                }
              }}
              title={`点击在右侧面板查看 ${item.name}`}
            >
              <span className="zcode-exploration-action">{item.action}</span>
              <span className="zcode-exploration-badge-box">{getFileBadge(item.ext)}</span>
              <span className="zcode-exploration-name">
                {item.name}
                {item.range && <span className="zcode-exploration-range">{item.range}</span>}
              </span>
              {item.path && (
                <span className="zcode-exploration-path">
                  {item.path}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
