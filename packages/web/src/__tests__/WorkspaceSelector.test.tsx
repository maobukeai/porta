import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceSelector } from "../components/WorkspaceSelector";

describe("WorkspaceSelector component", () => {
  const workspaces = [
    { uri: "file:///workspace/project-a", name: "project-a" },
    { uri: "file:///workspace/project-b", name: "project-b" },
    { uri: "file:///workspace/project-c", name: "project-c" },
    { uri: "file:///workspace/mobile-app", name: "mobile-app" },
    { uri: "file:///workspace/translation-tool", name: "translation-tool" },
    { uri: "file:///workspace/3d-learning", name: "3d-learning" },
  ];

  it("renders active workspace name and folder icon", () => {
    render(
      <WorkspaceSelector
        workspaces={workspaces}
        selected="file:///workspace/project-a"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.queryByText("选择工作区")).not.toBeInTheDocument();
  });

  it("opens dropdown menu on button click and shows all workspace options with count badge", () => {
    render(
      <WorkspaceSelector
        workspaces={workspaces}
        selected="file:///workspace/project-b"
        onSelect={vi.fn()}
      />,
    );

    const button = screen.getByTitle("选择工作区");
    fireEvent.click(button);

    expect(screen.getByText("选择工作区")).toBeInTheDocument();
    expect(screen.getByText("6 个")).toBeInTheDocument();
    expect(screen.getAllByText("project-b")).toHaveLength(2); // In button + in list
    expect(screen.getByText("mobile-app")).toBeInTheDocument();
    expect(screen.getByText("3d-learning")).toBeInTheDocument();
  });

  it("filters workspaces by search input and selects on Enter", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceSelector
        workspaces={workspaces}
        selected="file:///workspace/project-a"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTitle("选择工作区"));

    const searchInput = screen.getByPlaceholderText("搜索目录或项目...");
    fireEvent.change(searchInput, { target: { value: "3d" } });

    expect(screen.getByText("3d-learning")).toBeInTheDocument();
    expect(screen.queryByText("project-b")).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("file:///workspace/3d-learning");
  });

  it("shows empty state when search finds no matches", () => {
    render(
      <WorkspaceSelector
        workspaces={workspaces}
        selected="file:///workspace/project-a"
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("选择工作区"));
    const searchInput = screen.getByPlaceholderText("搜索目录或项目...");
    fireEvent.change(searchInput, { target: { value: "nonexistent-project-xyz" } });

    expect(screen.getByText("无匹配工作区")).toBeInTheDocument();
  });

  it("closes dropdown on Escape key", () => {
    render(
      <WorkspaceSelector
        workspaces={workspaces}
        selected="file:///workspace/project-a"
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("选择工作区"));
    expect(screen.getByText("选择工作区")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("选择工作区")).not.toBeInTheDocument();
  });
});
