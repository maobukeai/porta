import { IconX, IconTerminal, IconCheck, IconAlertTriangle } from "./Icons";
import type { TrajectoryStep } from "../types";
import { isSubagentToolName } from "../utils/subagents";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  steps: TrajectoryStep[];
}

export function ReasoningTreeModal({ isOpen, onClose, steps }: Props) {
  if (!isOpen) return null;

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <div className="branch-modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="branch-modal-header">
          <div className="branch-modal-title">
            <IconTerminal size={16} />
            <span>AI 推理树与 Step 执行分析器 ({steps.length} 步)</span>
          </div>
          <button onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="branch-modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <div className="branch-list">
            {steps.length === 0 ? (
              <div className="vscode-empty-hint">当前轨迹无显式推理步骤数据</div>
            ) : (
              steps.map((step, i) => {
                const typeStr = step.type || "STEP";
                const isSubagent = isSubagentToolName(typeStr);
                const isErr = step.status === "ERROR" || Boolean(step.error);

                return (
                  <div key={i} className="vscode-graph-item" style={{ flexDirection: "column", alignItems: "flex-start", padding: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <span className="vscode-file-badge TS">Step #{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isErr ? "#ef4444" : "#38bdf8" }}>
                        {typeStr}
                      </span>
                      {isErr ? <IconAlertTriangle size={12} style={{ color: "#ef4444" }} /> : <IconCheck size={12} style={{ color: "#10b981" }} />}
                    </div>

                    {isSubagent && (
                      <div style={{ fontSize: 11, color: "#a855f7", marginTop: 4 }}>
                        🤖 Subagent 派发执行
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
