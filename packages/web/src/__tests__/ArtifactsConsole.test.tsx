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

  it("extracts URL artifacts from read_url_content tool calls", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_TOOL_CALL",
        metadata: {
          toolCall: {
            name: "read_url_content",
            argumentsJson: JSON.stringify({ Url: "http://localhost:3000/api/health" }),
          },
        },
      },
    ];

    const artifacts = extractArtifactsFromSteps(mockSteps);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe("url");
    expect(artifacts[0].url).toBe("http://localhost:3000/api/health");
    expect(artifacts[0].title).toContain("本地实时预览");
  });

  it("extracts dev server URLs from command output and normalizes 0.0.0.0 to localhost", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        metadata: {
          output: "  ➜  Local:   http://0.0.0.0:5173/\n  ➜  Network: use --host to expose",
        },
      },
    ];

    const artifacts = extractArtifactsFromSteps(mockSteps);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe("url");
    expect(artifacts[0].url).toBe("http://localhost:5173/");
  });

  it("extracts dev server URLs from ANSI-colored terminal output", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        runCommand: {
          commandLine: "npm run dev",
          combinedOutput: {
            full: "  \u001b[32m➜\u001b[39m  \u001b[1mLocal:\u001b[22m   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n  \u001b[32m➜\u001b[39m  \u001b[1mNetwork:\u001b[22m \u001b[2muse --host to expose\u001b[22m",
          },
        },
      },
    ];

    const artifacts = extractArtifactsFromSteps(mockSteps);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe("url");
    expect(artifacts[0].url).toBe("http://localhost:5173/");
    expect(artifacts[0].title).toContain("实时服务预览");
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

  it("renders Git logs with Chinese relative time display", async () => {
    const { api } = await import("../api/client");
    vi.spyOn(api, "gitStatus").mockResolvedValue({
      branch: "main",
      files: [],
    });
    vi.spyOn(api, "gitLog").mockResolvedValue({
      logs: [
        {
          hash: "a1b2c3d",
          message: "feat: add chinese relative time",
          author: "Developer",
          relativeTime: "2 hours ago",
          date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          isHead: true,
        },
      ],
    });

    render(<ArtifactsConsole steps={[]} messages={[]} />);

    expect(await screen.findByText("feat: add chinese relative time")).toBeInTheDocument();
    expect(screen.getByText("2 小时前")).toBeInTheDocument();
  });

  it("renders URL artifacts with live preview iframe and viewport mode buttons", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        metadata: {
          output: "Local: http://localhost:5173/",
        },
      },
    ];

    render(<ArtifactsConsole steps={mockSteps} messages={[]} />);

    expect(screen.getByText("实时服务预览: http://localhost:5173/")).toBeInTheDocument();
    expect(screen.getByText("自适应")).toBeInTheDocument();
    expect(screen.getByText("手机")).toBeInTheDocument();
    expect(screen.getByText("平板")).toBeInTheDocument();

    const iframe = screen.getByTitle("实时服务预览: http://localhost:5173/");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", "http://localhost:5173/");

    // Switch to mobile viewport
    fireEvent.click(screen.getByText("手机"));
    const frameBox = iframe.parentElement;
    expect(frameBox).toHaveStyle({ width: "375px" });
  });
});

