import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { IconCamera } from "./Icons";

interface ModelConfig {
  label: string;
  modelOrAlias: { model: string };
  supportsImages: boolean;
  isRecommended: boolean;
  quotaInfo?: { remainingFraction: number };
}

interface Props {
  selectedModel: string | null;
  onSelect: (model: string) => void;
}

interface ParsedModel {
  config: ModelConfig;
  baseName: string;
  tier: string | null;
}

interface ModelGroup {
  baseName: string;
  items: ParsedModel[];
  hasTiers: boolean;
}

function parseModelLabel(config: ModelConfig): ParsedModel {
  const match = config.label.match(/^(.*?)(?:\s*\((Low|Medium|High|Thinking|低|中|高|思考)\))?$/i);
  if (match && match[2]) {
    const rawTier = match[2].trim();
    let tier = rawTier.charAt(0).toUpperCase() + rawTier.slice(1).toLowerCase();
    if (rawTier === "低") tier = "Low";
    if (rawTier === "中") tier = "Medium";
    if (rawTier === "高") tier = "High";
    if (rawTier === "思考") tier = "Thinking";
    return {
      config,
      baseName: match[1].trim(),
      tier,
    };
  }
  return {
    config,
    baseName: config.label,
    tier: null,
  };
}

export function ModelSelector({ selectedModel, onSelect }: Props) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [activeGroupHover, setActiveGroupHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const fetchModels = useCallback(async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await api.models();
        setModels(data.clientModelConfigs ?? []);
        setDefaultModel(
          data.defaultOverrideModelConfig?.modelOrAlias?.model ?? null,
        );
        setFetchError(false);
        return;
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }
    setFetchError(true);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Close on outside click/tap (mousedown covers desktop, touchstart covers mobile)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e instanceof TouchEvent ? e.touches[0]?.target : e.target;
      if (ref.current && target && !ref.current.contains(target as Node)) {
        setOpen(false);
        setActiveGroupHover(null);
      }
    };
    document.addEventListener("mousedown", handler as EventListener);
    document.addEventListener("touchstart", handler as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler as EventListener);
      document.removeEventListener("touchstart", handler as EventListener);
    };
  }, [open]);

  const active =
    selectedModel ??
    defaultModel ??
    models.find((m) => m.isRecommended)?.modelOrAlias?.model ??
    models[0]?.modelOrAlias?.model ??
    "gemini-3.6-flash-high";

  // Auto-bind default model if none selected — wait until models are loaded
  useEffect(() => {
    if (!selectedModel && active && models.length > 0) {
      onSelect(active);
    }
  }, [active, selectedModel, models.length, onSelect]);

  const groups = useMemo<ModelGroup[]>(() => {
    const map = new Map<string, ParsedModel[]>();
    for (const m of models) {
      const parsed = parseModelLabel(m);
      if (!map.has(parsed.baseName)) {
        map.set(parsed.baseName, []);
      }
      map.get(parsed.baseName)!.push(parsed);
    }

    const tierOrder: Record<string, number> = { Low: 1, Medium: 2, High: 3, Thinking: 4 };

    const result: ModelGroup[] = [];
    for (const [baseName, items] of map.entries()) {
      const hasTiers = items.some((i) => i.tier !== null) && items.length > 1;
      if (hasTiers) {
        items.sort((a, b) => (tierOrder[a.tier ?? ""] || 0) - (tierOrder[b.tier ?? ""] || 0));
      }
      result.push({ baseName, items, hasTiers });
    }

    const getGroupScore = (name: string) => {
      const n = name.toLowerCase();
      if (n.includes("3.6")) return 500;
      if (n.includes("3.5")) return 400;
      if (n.includes("3.1")) return 350;
      if (n.includes("sonnet")) return 300;
      if (n.includes("opus")) return 250;
      if (n.includes("gpt")) return 200;
      return 100;
    };

    result.sort((a, b) => getGroupScore(b.baseName) - getGroupScore(a.baseName));
    return result;
  }, [models]);

  const activeLabel = useMemo(() => {
    const found = models.find((m) => m.modelOrAlias.model === active);
    if (found) return found.label;
    if (active) {
      if (active.includes("gemini-3.6-flash")) return "Gemini 3.6 Flash (High)";
      if (active.includes("gemini-3.5-flash")) return "Gemini 3.5 Flash (Medium)";
      if (active.includes("gemini-3.1-pro")) return "Gemini 3.1 Pro (Low)";
      if (active.includes("claude-sonnet")) return "Claude Sonnet 4.6 (Thinking)";
      if (active.includes("claude-opus")) return "Claude Opus 4.6 (Thinking)";
      if (active.includes("gpt-oss")) return "GPT-OSS 120B (Medium)";
      return active;
    }
    return "Gemini 3.6 Flash (High)";
  }, [models, active]);

  const shortLabel = useMemo(() => {
    return activeLabel
      .replace(/\s*\((High|Medium|Low|Thinking|Default|[^\)]+)\)/gi, "")
      .trim() || activeLabel;
  }, [activeLabel]);

  return (
    <div className="model-selector" ref={ref}>
      <button
        className="model-selector-btn"
        onClick={() => {
          if (fetchError || models.length === 0) fetchModels();
          setOpen((v) => !v);
          setActiveGroupHover(null);
        }}
        title="选择模型"
      >
        <span className="model-selector-label">
          <span className="model-label-full">{activeLabel}</span>
          <span className="model-label-short">{shortLabel}</span>
        </span>
        <span className="model-selector-caret">▾</span>
      </button>
      {open && (
        <div className="model-selector-dropdown">
          <div className="model-selector-header">模型</div>
          {fetchError && (
            <button
              className="model-option"
              onClick={() => fetchModels()}
              style={{
                color: "var(--text-tertiary)",
                justifyContent: "center",
              }}
            >
              ⟳ 重新加载模型
            </button>
          )}
          {groups.map((group) => {
            if (!group.hasTiers) {
              const single = group.items[0];
              const isActive = single.config.modelOrAlias.model === active;
              const quota = single.config.quotaInfo?.remainingFraction ?? 1;
              return (
                <div
                  key={group.baseName}
                  className="model-option-container"
                  onMouseEnter={() => setActiveGroupHover(null)}
                >
                  <button
                    className={`model-option ${isActive ? "active" : ""}`}
                    onClick={() => {
                      onSelect(single.config.modelOrAlias.model);
                      setOpen(false);
                    }}
                  >
                    <span className="model-option-label">{single.config.label}</span>
                    <span className="model-option-meta">
                      {single.config.supportsImages && (
                        <>
                          <IconCamera size={12} />{" "}
                        </>
                      )}
                      {quota < 1 && (
                        <span
                          className="model-quota"
                          style={{
                            color: quota < 0.2 ? "var(--status-error)" : "inherit",
                          }}
                        >
                          {Math.round(quota * 100)}%
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              );
            }

            // Group with tiers (sub-menu)
            const activeInGroup = group.items.find(
              (i) => i.config.modelOrAlias.model === active,
            );
            const isGroupActive = !!activeInGroup;
            const currentTier = activeInGroup?.tier ?? group.items[group.items.length - 1].tier;
            const isSubOpen = activeGroupHover === group.baseName;
            const representativeModel = activeInGroup ?? group.items[0];
            const quota = representativeModel.config.quotaInfo?.remainingFraction ?? 1;

            return (
              <div
                key={group.baseName}
                className="model-option-container"
                // Desktop hover: only react to real mouse pointer, not touch synthesis
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setActiveGroupHover(group.baseName); }}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setActiveGroupHover(null); }}
              >
                <button
                  className={`model-option ${isGroupActive ? "active" : ""} ${
                    isSubOpen ? "sub-open" : ""
                  }`}
                  onClick={() => {
                    setActiveGroupHover(
                      activeGroupHover === group.baseName ? null : group.baseName,
                    );
                  }}
                >
                  <span className="model-option-label">{group.baseName}</span>
                  <span className="model-option-tier-badge">{currentTier}</span>
                  <span className="model-option-meta">
                    {representativeModel.config.supportsImages && (
                      <>
                        <IconCamera size={12} />{" "}
                      </>
                    )}
                    {quota < 1 && (
                      <span
                        className="model-quota"
                        style={{
                          color: quota < 0.2 ? "var(--status-error)" : "inherit",
                        }}
                      >
                        {Math.round(quota * 100)}%
                      </span>
                    )}
                  </span>
                  <span className="model-option-arrow">›</span>
                </button>

                {isSubOpen && (
                  <div className="model-submenu">
                    {group.items.map((item) => {
                      const isItemActive = item.config.modelOrAlias.model === active;
                      return (
                        <button
                          key={item.config.modelOrAlias.model}
                          className={`model-submenu-item ${
                            isItemActive ? "active" : ""
                          }`}
                          onClick={() => {
                            onSelect(item.config.modelOrAlias.model);
                            setOpen(false);
                            setActiveGroupHover(null);
                          }}
                        >
                          {item.tier}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

