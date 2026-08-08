import { IconSparkles, IconX } from "./Icons";
import { triggerHaptic } from "../utils/haptics";
import { DEFAULT_PROMPT_PRESETS, type PromptPreset } from "../utils/promptPresets";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset: (preset: PromptPreset) => void;
}

export function QuickCommandSheet({ isOpen, onClose, onSelectPreset }: Props) {
  if (!isOpen) return null;

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <div className="branch-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="branch-modal-header">
          <div className="branch-modal-title">
            <IconSparkles size={16} />
            <span>常用 Prompt 预设与快捷指令库</span>
          </div>
          <button onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="branch-modal-body">
          <div className="branch-list">
            {DEFAULT_PROMPT_PRESETS.map((preset) => (
              <div
                key={preset.cmd}
                className="branch-item"
                onClick={() => {
                  triggerHaptic("light");
                  onSelectPreset(preset);
                  onClose();
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)" }}>
                    {preset.cmd} — {preset.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                    {preset.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
