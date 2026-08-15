import React, { useState, useRef, useEffect } from "react";
import {
  IconHand,
  IconShieldCheck,
  IconPlan,
  IconShieldAlert,
  IconCheck,
  IconChevronDown,
  type IconProps,
} from "./Icons";
import type { ExecutionMode } from "../types";

export interface ExecutionModeOption {
  value: ExecutionMode;
  label: string;
  desc: string;
  icon: (props: IconProps) => React.JSX.Element;
  isWarning?: boolean;
}

export const EXECUTION_MODE_OPTIONS: ExecutionModeOption[] = [
  {
    value: "review_before_edit",
    label: "变更前确认",
    desc: "改文件前先问我。",
    icon: IconHand,
  },
  {
    value: "auto_edit",
    label: "自动编辑",
    desc: "自动编辑文件。",
    icon: IconShieldCheck,
  },
  {
    value: "planning",
    label: "计划模式",
    desc: "编辑前先出计划。",
    icon: IconPlan,
  },
  {
    value: "full_access",
    label: "完全访问",
    desc: "减少确认次数。",
    icon: IconShieldAlert,
    isWarning: true,
  },
];

interface Props {
  mode: ExecutionMode;
  onSelect: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

export function ExecutionModeSelector({ mode, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeOption =
    EXECUTION_MODE_OPTIONS.find((opt) => opt.value === mode) ||
    EXECUTION_MODE_OPTIONS[3]; // default to full_access

  const ActiveIcon = activeOption.icon;

  return (
    <div className="execution-mode-selector" ref={ref}>
      <button
        type="button"
        className={`execution-mode-btn mode-${activeOption.value} ${
          activeOption.isWarning ? "is-warning" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={`当前模式: ${activeOption.label} (${activeOption.desc})`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="execution-mode-btn-icon">
          <ActiveIcon size={15} />
        </span>
        <span className="execution-mode-btn-label">{activeOption.label}</span>
        <span className="execution-mode-btn-chevron">
          <IconChevronDown size={13} />
        </span>
      </button>

      {open && (
        <div className="execution-mode-dropdown" role="listbox">
          {EXECUTION_MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`execution-mode-item mode-${opt.value} ${
                  isSelected ? "selected" : ""
                } ${opt.isWarning ? "is-warning" : ""}`}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <div className="execution-mode-item-icon">
                  <Icon size={18} />
                </div>
                <div className="execution-mode-item-content">
                  <div className="execution-mode-item-title">{opt.label}</div>
                  <div className="execution-mode-item-desc">{opt.desc}</div>
                </div>
                {isSelected && (
                  <div className="execution-mode-item-check">
                    <IconCheck size={16} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
