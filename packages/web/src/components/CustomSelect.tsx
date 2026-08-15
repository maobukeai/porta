import React, { useState, useRef, useEffect, useCallback } from "react";
import { IconChevronDown, IconCheck } from "./Icons";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  subLabel?: string;
  icon?: React.ReactNode;
}

export interface SelectGroup<T extends string = string> {
  groupLabel: string;
  options: SelectOption<T>[];
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectGroup<T>[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  groups,
  placeholder = "请选择...",
  className = "",
  style,
  disabled = false,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (!open) {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        // If less than 240px below and at least 200px above, open upward
        if (spaceBelow < 240 && rect.top > 200) {
          setDirection("up");
        } else {
          setDirection("down");
        }
      }
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [open, disabled]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Flatten all options to find the selected one
  const allOptions: SelectOption<T>[] = [
    ...(options ?? []),
    ...(groups ? groups.flatMap((g) => g.options) : []),
  ];

  const selectedOption = allOptions.find((opt) => opt.value === value);

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${open ? "open" : ""} ${disabled ? "disabled" : ""} ${className}`}
      style={style}
    >
      <button
        type="button"
        className="custom-select-trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="custom-select-label-wrap">
          {selectedOption?.icon && <span className="custom-select-icon">{selectedOption.icon}</span>}
          <span className="custom-select-text">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.subLabel && (
            <span className="custom-select-subtext">{selectedOption.subLabel}</span>
          )}
        </span>
        <IconChevronDown size={14} className="custom-select-chevron" />
      </button>

      {open && (
        <div className={`custom-select-dropdown direction-${direction}`} role="listbox">
          {options &&
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`custom-select-item ${isSelected ? "selected" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <div className="custom-select-item-content">
                    {opt.icon && <span className="custom-select-item-icon">{opt.icon}</span>}
                    <div className="custom-select-item-text-group">
                      <span className="custom-select-item-title">{opt.label}</span>
                      {opt.subLabel && (
                        <span className="custom-select-item-desc">{opt.subLabel}</span>
                      )}
                    </div>
                  </div>
                  {isSelected && <IconCheck size={14} className="custom-select-check" />}
                </div>
              );
            })}

          {groups &&
            groups.map((grp) => (
              <div key={grp.groupLabel} className="custom-select-group">
                <div className="custom-select-group-header">{grp.groupLabel}</div>
                {grp.options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <div
                      key={opt.value}
                      className={`custom-select-item ${isSelected ? "selected" : ""}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <div className="custom-select-item-content">
                        {opt.icon && <span className="custom-select-item-icon">{opt.icon}</span>}
                        <div className="custom-select-item-text-group">
                          <span className="custom-select-item-title">{opt.label}</span>
                          {opt.subLabel && (
                            <span className="custom-select-item-desc">{opt.subLabel}</span>
                          )}
                        </div>
                      </div>
                      {isSelected && <IconCheck size={14} className="custom-select-check" />}
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
