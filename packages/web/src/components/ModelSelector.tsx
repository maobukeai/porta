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
  const match = config.label.match(/^(.*?)(?:\s*\((Low|Medium|High)\))?$/i);
  if (match && match[2]) {
    return {
      config,
      baseName: match[1].trim(),
      tier: match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase(),
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

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveGroupHover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = selectedModel ?? defaultModel;

  const groups = useMemo<ModelGroup[]>(() => {
    const map = new Map<string, ParsedModel[]>();
    for (const m of models) {
      const parsed = parseModelLabel(m);
      if (!map.has(parsed.baseName)) {
        map.set(parsed.baseName, []);
      }
      map.get(parsed.baseName)!.push(parsed);
    }

    const tierOrder: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

    const result: ModelGroup[] = [];
    for (const [baseName, items] of map.entries()) {
      const hasTiers = items.some((i) => i.tier !== null) && items.length > 1;
      if (hasTiers) {
        items.sort((a, b) => (tierOrder[a.tier ?? ""] || 0) - (tierOrder[b.tier ?? ""] || 0));
      }
      result.push({ baseName, items, hasTiers });
    }

    const getGroupScore = (name: string) => {
      if (name.includes("3.6")) return 300;
      if (name.includes("4.6")) return 250;
      if (name.includes("3.5")) return 200;
      if (name.includes("3.1")) return 100;
      return 50;
    };

    result.sort((a, b) => getGroupScore(b.baseName) - getGroupScore(a.baseName));
    return result;
  }, [models]);

  const activeLabel = useMemo(() => {
    const found = models.find((m) => m.modelOrAlias.model === active);
    return found ? found.label : "模型";
  }, [models, active]);

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
        <span className="model-selector-label">{activeLabel}</span>
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
                onMouseEnter={() => setActiveGroupHover(group.baseName)}
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

