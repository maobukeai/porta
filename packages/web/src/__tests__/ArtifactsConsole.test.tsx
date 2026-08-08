import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ArtifactsConsole } from "../components/ArtifactsConsole";
import { extractArtifactsFromSteps } from "../utils/extractArtifacts";
import type { TrajectoryStep } from "../types";

describe("extractArtifactsFromSteps", () => {
  it("extracts code blocks from planner responses", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse:
            "Here is the code:\n```typescript\nconst x: number = 42;\n```\nEnjoy!",
        },
      },
    ];

    const artifacts = extractArtifactsFromSteps(mockSteps);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe("code");
    expect(artifacts[0].language).toBe("typescript");
    expect(artifacts[0].content).toBe("const x: number = 42;");
  });

  it("extracts file edits from replaceFileContent steps", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_REPLACE_FILE_CONTENT",
        replaceFileContent: {
          targetFile: "src/App.tsx",
          replacementContent: "export default function App() { return null; }",
        },
      },
    ];

    const artifacts = extractArtifactsFromSteps(mockSteps);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe("diff");
    expect(artifacts[0].title).toContain("App.tsx");
  });
});

describe("ArtifactsConsole Component UI", () => {
  it("renders empty state when no artifacts are found", () => {
    render(<ArtifactsConsole steps={[]} messages={[]} />);
    expect(
      screen.getByText("当前对话暂无可展示的交付物或代码产物"),
    ).toBeInTheDocument();
  });

  it("renders extracted artifacts and supports search filtering", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "```typescript\nconst score = 100;\n```",
        },
      },
    ];

    render(<ArtifactsConsole steps={mockSteps} messages={[]} />);

    expect(
      screen.getByText("Artifacts 交付物与 Git 控制台"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/TYPESCRIPT/i).length).toBeGreaterThan(0);
    expect(screen.getByText("const score = 100;")).toBeInTheDocument();

    // Test search filter
    const searchInput = screen.getByPlaceholderText(/搜索代码/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    expect(
      screen.getByText("当前对话暂无可展示的交付物或代码产物"),
    ).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<ArtifactsConsole steps={[]} messages={[]} onClose={onClose} />);

    const closeBtn = screen.getByTitle("返回对话");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
