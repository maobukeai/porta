import React, { useState } from "react";
import {
  IconBookOpen,
  IconChevron,
  IconFileReview,
  IconCopy,
  IconCheck,
  IconThumbsUp,
  IconThumbsDown,
  IconReact,
  IconFileCode,
  IconFileText,
  IconPrisma,
} from "./Icons";
import { copyText } from "../utils/clipboard";
import { triggerHaptic } from "../utils/haptics";
import type { TurnSummaryData, TurnArtifactItem } from "../utils/extractTurnSummary";

interface Props {
  summary: TurnSummaryData;
  assistantContent?: string;
  onOpenFile?: (file: { name: string; path?: string; ext?: string; range?: string }) => void;
  onOpenReview?: () => void;
}

function getFileTypeIcon(fileName: string, ext: string) {
  const e = ext.toLowerCase() || fileName.split(".").pop()?.toLowerCase() || "";
  if (e === "prisma") {
    return <IconPrisma size={14} className="turn-file-icon prisma" style={{ color: "#10b981" }} />;
  }
  if (e === "tsx" || e === "jsx") {
    return <IconReact size={14} className="turn-file-icon react" style={{ color: "#38bdf8" }} />;
  }
  if (e === "ts" || e === "mts") {
    return (
      <span className="turn-file-icon-badge ts" style={{ color: "#60a5fa" }}>
        TS
      </span>
    );
  }
  if (e === "js" || e === "mjs") {
    return (
      <span className="turn-file-icon-badge js" style={{ color: "#facc15" }}>
        JS
      </span>
    );
  }
  if (e === "css" || e === "scss" || e === "less") {
    return <IconFileCode size={14} className="turn-file-icon css" style={{ color: "#38bdf8" }} />;
  }
  if (e === "json") {
    return <IconFileCode size={14} className="turn-file-icon json" style={{ color: "#fbbf24" }} />;
  }
  if (e === "html") {
    return <IconFileCode size={14} className="turn-file-icon html" style={{ color: "#fb923c" }} />;
  }
  if (e === "md" || e === "markdown" || e === "txt") {
    return <IconFileText size={14} className="turn-file-icon md" style={{ color: "#94a3b8" }} />;
  }
  return <IconFileCode size={14} className="turn-file-icon default" style={{ color: "#9ca3af" }} />;
}

export const TurnSummaryCard = React.memo(function TurnSummaryCard({
  summary,
  assistantContent = "",
  onOpenFile,
  onOpenReview,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  const hasFiles = summary.files.length > 0;
  const hasArtifacts = summary.artifacts.length > 0;

  const handleCopy = () => {
    if (!assistantContent) return;
    void copyText(assistantContent).then((ok) => {
      if (ok) {
        triggerHaptic("light");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const handleThumbsUp = () => {
    triggerHaptic("light");
    setRating((prev) => (prev === "up" ? null : "up"));
  };

  const handleThumbsDown = () => {
    triggerHaptic("light");
    setRating((prev) => (prev === "down" ? null : "down"));
  };

  const handleReviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic("medium");
    if (onOpenReview) {
      onOpenReview();
    } else if (summary.files.length > 0 && onOpenFile) {
      const first = summary.files[0];
      onOpenFile({ name: first.name, path: first.fullPath, ext: first.ext });
    }
  };

  const handleFileClick = (file: typeof summary.files[0]) => {
    triggerHaptic("light");
    if (onOpenFile) {
      onOpenFile({ name: file.name, path: file.fullPath, ext: file.ext });
    }
  };

  const handleArtifactClick = (artifact: TurnArtifactItem) => {
    triggerHaptic("light");
    if (onOpenFile && artifact.path) {
      const clean = artifact.path.replace(/^file:\/\/\/?/, "");
      const name = clean.split("/").pop() || artifact.title;
      onOpenFile({ name, path: clean, ext: "md" });
    } else if (onOpenReview) {
      onOpenReview();
    }
  };

  const formatPathDisplay = (fullPath: string, name: string) => {
    if (!fullPath) return "";
    let clean = fullPath.replace(/\\/g, "/");
    // Ensure leading slash for Unix/Windows display consistency with IDE
    if (!clean.startsWith("/")) {
      clean = "/" + clean;
    }
    // Remove filename from end for directory path display
    if (clean.endsWith("/" + name)) {
      clean = clean.slice(0, -(name.length + 1));
    }
    return clean;
  };

  return (
    <div className="turn-summary-container">
      {/* 1. Artifact Pills (Walkthrough, Implementation Plan) */}
      {hasArtifacts && (
        <div className="turn-artifacts-list">
          {summary.artifacts.map((art) => (
            <button
              key={art.id}
              type="button"
              className="turn-artifact-pill-btn"
              onClick={() => handleArtifactClick(art)}
              title="点击查看此交付物"
            >
              <IconBookOpen size={13} className="turn-artifact-icon" />
              <span className="turn-artifact-title">{art.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* 2. File Changes Summary Card */}
      {hasFiles && (
        <div className="turn-files-summary-card">
          {/* Header */}
          <div className="turn-files-header">
            <div
              className="turn-files-header-left"
              onClick={() => {
                triggerHaptic("light");
                setExpanded((v) => !v);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }}
            >
              <span className="turn-files-count-text">
                {summary.files.length} {summary.files.length === 1 ? "file" : "files"} changed
              </span>
              {summary.totalAdditions > 0 && (
                <span className="turn-stat-add">+{summary.totalAdditions}</span>
              )}
              {summary.totalDeletions > 0 && (
                <span className="turn-stat-del">-{summary.totalDeletions}</span>
              )}
              <span className={`turn-chevron-wrap ${expanded ? "is-open" : ""}`}>
                <IconChevron size={11} className="turn-chevron-icon" />
              </span>
            </div>

            <div className="turn-files-header-right">
              <button
                type="button"
                className="turn-review-btn"
                onClick={handleReviewClick}
                title="在审查面板中打开代码 Diff"
              >
                <IconFileReview size={13} className="turn-review-icon" />
                <span>Review</span>
              </button>
            </div>
          </div>

          {/* Expanded File List */}
          {expanded && (
            <div className="turn-files-list">
              {summary.files.map((f, i) => {
                const dirPath = formatPathDisplay(f.fullPath, f.name);
                return (
                  <div
                    key={`${f.fullPath}-${i}`}
                    className="turn-file-row"
                    onClick={() => handleFileClick(f)}
                    role="button"
                    tabIndex={0}
                    title={`点击审查 ${f.name} 的修改`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleFileClick(f);
                      }
                    }}
                  >
                    <div className="turn-file-icon-wrap">
                      {getFileTypeIcon(f.name, f.ext)}
                    </div>
                    <span className="turn-file-name">{f.name}</span>
                    {dirPath && (
                      <span className="turn-file-dir-path" title={f.fullPath}>
                        {dirPath}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Turn Footer: Timestamp & Actions */}
      <div className="turn-footer-row">
        <span className="turn-timestamp">{summary.timestamp || ""}</span>
        <div className="turn-feedback-actions">
          {assistantContent && (
            <button
              type="button"
              className={`turn-action-icon-btn ${copied ? "copied" : ""}`}
              onClick={handleCopy}
              title="复制回复"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          )}
          <button
            type="button"
            className={`turn-action-icon-btn ${rating === "up" ? "active-like" : ""}`}
            onClick={handleThumbsUp}
            title="好评"
          >
            <IconThumbsUp size={14} />
          </button>
          <button
            type="button"
            className={`turn-action-icon-btn ${rating === "down" ? "active-dislike" : ""}`}
            onClick={handleThumbsDown}
            title="差评"
          >
            <IconThumbsDown size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});
