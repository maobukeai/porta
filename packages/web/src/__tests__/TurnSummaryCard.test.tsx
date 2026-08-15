import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TurnSummaryCard } from "../components/TurnSummaryCard";
import { extractTurnSummary } from "../utils/extractTurnSummary";
import type { ChatMessage, TrajectoryStep } from "../types";

describe("extractTurnSummary", () => {
  it("extracts multiple modified files, additions and deletions across turn steps", () => {
    const step1: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_CODE_ACTION",
      codeAction: {
        actionResult: {
          edit: {
            absoluteUri: "file:///packages/web/src/__tests__/SettingsPanel.test.tsx",
            diff: {
              unifiedDiff: {
                lines: [
                  { type: "UNIFIED_DIFF_LINE_TYPE_INSERT", text: "line 1" },
                  { type: "UNIFIED_DIFF_LINE_TYPE_INSERT", text: "line 2" },
                  { type: "UNIFIED_DIFF_LINE_TYPE_DELETE", text: "old line" },
                ],
              },
            },
          },
        },
      },
    };

    const step2: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_CODE_ACTION",
      metadata: {
        toolCall: {
          name: "replace_file_content",
          args: {
            TargetFile: "c:/Users/20269/Desktop/项目/packages/web/src/components/AccountQuotaModal.tsx",
            ReplacementContent: "line1\nline2\nline3\nline4",
            TargetContent: "old1\nold2",
          },
        },
      },
    };

    const step3: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_CODE_ACTION",
      metadata: {
        toolCall: {
          name: "write_to_file",
          args: {
            TargetFile: "c:/Users/20269/Desktop/项目/packages/web/src/utils/quotaCache.ts",
            CodeContent: "export const cached = true;\nexport const x = 1;\n",
          },
        },
      },
    };

    const stepMessages: ChatMessage[] = [
      { role: "system", content: "", stepIndex: 1, type: "CORTEX_STEP_TYPE_CODE_ACTION", step: step1 },
      { role: "system", content: "", stepIndex: 2, type: "CORTEX_STEP_TYPE_CODE_ACTION", step: step2 },
      { role: "system", content: "", stepIndex: 3, type: "CORTEX_STEP_TYPE_CODE_ACTION", step: step3 },
    ];

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "Task complete!\n\n[Walkthrough](file:///brain/walkthrough.md)",
      stepIndex: 4,
      type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
    };

    const summary = extractTurnSummary(stepMessages, assistantMsg);

    expect(summary.files).toHaveLength(3);
    expect(summary.files[0].name).toBe("SettingsPanel.test.tsx");
    expect(summary.files[0].additions).toBe(2);
    expect(summary.files[0].deletions).toBe(1);

    expect(summary.files[1].name).toBe("AccountQuotaModal.tsx");
    expect(summary.files[1].additions).toBe(4);
    expect(summary.files[1].deletions).toBe(2);

    expect(summary.files[2].name).toBe("quotaCache.ts");
    expect(summary.files[2].additions).toBe(3);

    expect(summary.totalAdditions).toBe(9);
    expect(summary.totalDeletions).toBe(3);

    expect(summary.artifacts).toHaveLength(1);
    expect(summary.artifacts[0].title).toBe("Walkthrough");
  });
});

describe("TurnSummaryCard Component", () => {
  it("renders files changed card, review button, and artifact pills matching desktop client", () => {
    const summary = {
      files: [
        {
          name: "SettingsPanel.test.tsx",
          path: "packages/web/src/__tests__/",
          fullPath: "c:/Users/20269/Desktop/项目/packages/web/src/__tests__/SettingsPanel.test.tsx",
          ext: "tsx",
          additions: 150,
          deletions: 13,
        },
        {
          name: "AccountQuotaModal.tsx",
          path: "packages/web/src/components/",
          fullPath: "c:/Users/20269/Desktop/项目/packages/web/src/components/AccountQuotaModal.tsx",
          ext: "tsx",
          additions: 45,
          deletions: 5,
        },
        {
          name: "quotaCache.ts",
          path: "packages/web/src/utils/",
          fullPath: "c:/Users/20269/Desktop/项目/packages/web/src/utils/quotaCache.ts",
          ext: "ts",
          additions: 20,
          deletions: 0,
        },
      ],
      totalAdditions: 215,
      totalDeletions: 18,
      artifacts: [
        {
          id: "walkthrough",
          title: "Walkthrough",
          type: "walkthrough" as const,
          path: "file:///brain/walkthrough.md",
        },
      ],
      timestamp: "12:53",
    };

    const handleOpenFile = vi.fn();
    const handleOpenReview = vi.fn();

    render(
      <TurnSummaryCard
        summary={summary}
        assistantContent="Here is the solution."
        onOpenFile={handleOpenFile}
        onOpenReview={handleOpenReview}
      />,
    );

    // 1. Walkthrough artifact pill
    expect(screen.getByText("Walkthrough")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Walkthrough"));
    expect(handleOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "walkthrough.md", ext: "md" }),
    );

    // 2. Files changed summary header (collapsed by default)
    const headerBtn = screen.getByText("3 files changed");
    expect(headerBtn).toBeInTheDocument();
    expect(screen.getByText("+215")).toBeInTheDocument();
    expect(screen.getByText("-18")).toBeInTheDocument();

    // Initially collapsed
    expect(screen.queryByText("SettingsPanel.test.tsx")).toBeNull();

    // 3. Review button
    const reviewBtn = screen.getByRole("button", { name: /Review/i });
    expect(reviewBtn).toBeInTheDocument();
    fireEvent.click(reviewBtn);
    expect(handleOpenReview).toHaveBeenCalled();

    // 4. Click header to expand file items
    fireEvent.click(headerBtn);
    expect(screen.getByText("SettingsPanel.test.tsx")).toBeInTheDocument();
    expect(screen.getByText("AccountQuotaModal.tsx")).toBeInTheDocument();
    expect(screen.getByText("quotaCache.ts")).toBeInTheDocument();

    // 5. Click individual file
    fireEvent.click(screen.getByText("quotaCache.ts"));
    expect(handleOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "quotaCache.ts",
        ext: "ts",
        path: "c:/Users/20269/Desktop/项目/packages/web/src/utils/quotaCache.ts",
      }),
    );

    // 6. Timestamp and Actions
    expect(screen.getByText("12:53")).toBeInTheDocument();
    const likeBtn = screen.getByTitle("好评");
    fireEvent.click(likeBtn);
    expect(likeBtn).toHaveClass("active-like");
  });
});
