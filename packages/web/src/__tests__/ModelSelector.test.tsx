import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelSelector, CircularProgressRing } from "../components/ModelSelector";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    models: vi.fn(),
    userStatus: vi.fn(),
    quota: vi.fn(),
  },
}));

describe("ModelSelector & View Usage (查看额度)", () => {
  const mockModelsData = {
    clientModelConfigs: [
      {
        label: "Gemini 3.7 Flash (High)",
        modelOrAlias: { model: "MODEL_PLACEHOLDER_M298" },
        supportsImages: true,
        isRecommended: true,
        quotaInfo: { remainingFraction: 0.89, resetTime: "2026-08-15T18:00:00Z" },
      },
      {
        label: "Gemini 3.7 Flash (Medium)",
        modelOrAlias: { model: "MODEL_PLACEHOLDER_M299" },
        supportsImages: true,
        isRecommended: false,
        quotaInfo: { remainingFraction: 0.89 },
      },
      {
        label: "Gemini 3.6 Flash (Medium)",
        modelOrAlias: { model: "MODEL_PLACEHOLDER_M72" },
        supportsImages: true,
        isRecommended: false,
        quotaInfo: { remainingFraction: 0.34, resetTime: "2026-08-15T16:30:00Z" },
      },
      {
        label: "Claude Sonnet 4.6 (Thinking)",
        modelOrAlias: { model: "MODEL_PLACEHOLDER_M35" },
        supportsImages: true,
        isRecommended: false,
        quotaInfo: { remainingFraction: 0.94 },
      },
      {
        label: "GPT-OSS 120B (Medium)",
        modelOrAlias: { model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM" },
        supportsImages: true,
        isRecommended: false,
        quotaInfo: { remainingFraction: 1.0 },
      },
    ],
    defaultOverrideModelConfig: { modelOrAlias: { model: "MODEL_PLACEHOLDER_M298" } },
  };

  const mockUserStatusWithSummary = {
    userStatus: {
      name: "Developer",
      userQuotaSummary: {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.89 },
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.34,
                resetTime: "2026-08-15T17:57:00Z",
              },
            ],
          },
          {
            displayName: "Claude & GPT Models",
            buckets: [
              { bucketId: "3p-weekly", window: "weekly", remainingFraction: 0.94 },
              { bucketId: "3p-5h", window: "5h", remainingFraction: 1.0 },
            ],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.models as any).mockResolvedValue(mockModelsData);
    (api.userStatus as any).mockResolvedValue(mockUserStatusWithSummary);
    (api.quota as any).mockResolvedValue(mockUserStatusWithSummary.userStatus.userQuotaSummary);
  });

  it("renders trigger button with active model label", async () => {
    const onSelect = vi.fn();
    render(
      <ModelSelector
        selectedModel="MODEL_PLACEHOLDER_M298"
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini 3.7 Flash (High)")).toBeInTheDocument();
    });
  });

  it("opens popup and renders model list and '查看额度' item", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ModelSelector
        selectedModel="MODEL_PLACEHOLDER_M298"
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini 3.7 Flash (High)")).toBeInTheDocument();
    });

    // Open cascader
    fireEvent.click(screen.getByText("Gemini 3.7 Flash (High)"));

    expect(screen.getByText("模型")).toBeInTheDocument();
    const providerNames = container.querySelectorAll(".zcode-provider-name");
    const names = Array.from(providerNames).map((el) => el.textContent?.trim());
    expect(names).toContain("Gemini 3.7 Flash");
    expect(names).toContain("Gemini 3.6 Flash");
    expect(names).toContain("查看额度");
    expect(screen.queryByText("管理模型")).toBeNull();
  });

  it("renders quota / usage view when clicking '查看额度'", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ModelSelector
        selectedModel="MODEL_PLACEHOLDER_M298"
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini 3.7 Flash (High)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Gemini 3.7 Flash (High)"));

    const viewUsageItem = container.querySelector(".zcode-usage-menu-item");
    expect(viewUsageItem).not.toBeNull();
    fireEvent.click(viewUsageItem!);

    await waitFor(() => {
      expect(screen.getByText("使用额度")).toBeInTheDocument();
    });

    // Check Gemini section
    expect(screen.getByText("Gemini 系列模型")).toBeInTheDocument();
    expect(screen.getByText("89%")).toBeInTheDocument();
    expect(screen.getByText("34%")).toBeInTheDocument();

    // Check Claude & GPT section
    expect(screen.getByText("Claude 与 GPT 系列模型")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("selects a model tier and closes the dropdown", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ModelSelector
        selectedModel="MODEL_PLACEHOLDER_M298"
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini 3.7 Flash (High)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Gemini 3.7 Flash (High)"));

    // Find first provider item in left panel
    const firstProvider = container.querySelector(".zcode-provider-item");
    expect(firstProvider).not.toBeNull();
    fireEvent.click(firstProvider!);

    // Find and click Medium tier
    const mediumTier = screen.getByText("Medium (中思考)");
    fireEvent.click(mediumTier);

    expect(onSelect).toHaveBeenCalledWith("MODEL_PLACEHOLDER_M299");
  });

  it("handles fallback to model configs when userQuotaSummary is empty", async () => {
    (api.userStatus as any).mockResolvedValue({ userStatus: {} });

    const onSelect = vi.fn();
    const { container } = render(
      <ModelSelector
        selectedModel="MODEL_PLACEHOLDER_M298"
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Gemini 3.7 Flash (High)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Gemini 3.7 Flash (High)"));
    const viewUsageItem = container.querySelector(".zcode-usage-menu-item");
    fireEvent.click(viewUsageItem!);

    await waitFor(() => {
      expect(screen.getByText("使用额度")).toBeInTheDocument();
    });

    expect(screen.getByText("Gemini 系列模型")).toBeInTheDocument();
    expect(screen.getByText("Claude 与 GPT 系列模型")).toBeInTheDocument();
  });

  it("renders CircularProgressRing correctly with different fraction inputs", () => {
    const { container: greenRing } = render(<CircularProgressRing fraction={0.89} size={16} />);
    const indicatorGreen = greenRing.querySelector(".zcode-ring-indicator");
    expect(indicatorGreen).toHaveAttribute("stroke", "#34a853");

    const { container: yellowRing } = render(<CircularProgressRing fraction={0.45} size={16} />);
    const indicatorYellow = yellowRing.querySelector(".zcode-ring-indicator");
    expect(indicatorYellow).toHaveAttribute("stroke", "#eab308");

    const { container: redRing } = render(<CircularProgressRing fraction={0.15} size={16} />);
    const indicatorRed = redRing.querySelector(".zcode-ring-indicator");
    expect(indicatorRed).toHaveAttribute("stroke", "#ef4444");
  });
});
