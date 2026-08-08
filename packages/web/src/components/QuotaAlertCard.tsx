import { useState } from "react";
import { IconAlertTriangle, IconClock, IconChevron } from "./Icons";
import { parseQuotaError } from "../utils/quotaError";

interface Props {
  content: string;
}

export function QuotaAlertCard({ content }: Props) {
  const [expanded, setExpanded] = useState(false);
  const info = parseQuotaError(content);

  return (
    <div className={`quota-alert-card ${expanded ? "expanded" : "compact"}`}>
      <div className="quota-alert-row" onClick={() => setExpanded((v) => !v)}>
        <div className="quota-alert-left">
          <IconAlertTriangle size={15} className="quota-alert-icon" />
          <span className="quota-alert-title">{info.title}</span>
          {info.refreshTime && (
            <span className="quota-refresh-pill">
              <IconClock size={11} />
              <span>{info.refreshTime}</span>
            </span>
          )}
        </div>
        <button
          className="quota-expand-btn"
          aria-label={expanded ? "收起详情" : "展开详情"}
          title={expanded ? "收起详情" : "展开详情"}
        >
          <span className="quota-expand-label">{expanded ? "收起" : "详情"}</span>
          <IconChevron
            size={12}
            className={`quota-chevron ${expanded ? "open" : ""}`}
          />
        </button>
      </div>

      {expanded && (
        <div className="quota-alert-details">
          <p className="quota-detail-text">{info.detail}</p>
          <div className="quota-suggestion-box">
            <span>{info.suggestion}</span>
          </div>

          {info.rawError && (
            <div className="quota-raw-wrapper">
              <span className="quota-raw-label">原始报错文本：</span>
              <pre className="quota-raw-log">
                <code>{info.rawError}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
