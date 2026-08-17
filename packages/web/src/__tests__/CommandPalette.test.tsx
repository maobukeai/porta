import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CommandPalette, type CommandPaletteAction } from "../components/CommandPalette";
import { useContextMenu } from "../components/ContextMenu";

// ── Command palette ──

const actions: CommandPaletteAction[] = [
  {
    id: "new-chat",
    label: "新建对话",
    hint: "Ctrl+N",
    keywords: "新建 chat",
    icon: <span data-testid="icon-new" />,
    run: () => {},
  },
  {
    id: "terminal",
    label: "打开终端",
    keywords: "terminal 命令行",
    icon: <span data-testid="icon-term" />,
    run: () => {},
  },
];

const conversations = [
  {
    id: "conv-1",
    title: "远程端显示异常排查",
    workspaceName: "antigravity移动端",
    lastModifiedTime: "2026-08-17T10:00:00Z",
  },
  {
    id: "conv-2",
    title: "翻译软件重构",
    workspaceName: "翻译软件",
    lastModifiedTime: "2026-08-10T10:00:00Z",
  },
];

const workspaces = [
  { uri: "file:///ws/a", name: "工作区A" },
  { uri: "file:///ws/b", name: "workspace-b" },
];

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onSelectConversation = vi.fn();
  const onSelectWorkspace = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette
      open
      onClose={onClose}
      actions={actions}
      conversations={conversations}
      workspaces={workspaces}
      onSelectConversation={onSelectConversation}
      onSelectWorkspace={onSelectWorkspace}
      {...overrides}
    />,
  );
  return { ...utils, onSelectConversation, onSelectWorkspace, onClose };
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    renderPalette({ open: false });
    expect(screen.queryByText("新建对话")).toBeNull();
  });

  it("shows grouped actions, workspaces and conversations when open with empty query", () => {
    renderPalette();
    expect(screen.getByText("动作")).toBeInTheDocument();
    expect(screen.getByText("工作区")).toBeInTheDocument();
    expect(screen.getByText("会话")).toBeInTheDocument();
    expect(screen.getByText("新建对话")).toBeInTheDocument();
    expect(screen.getByText("工作区A")).toBeInTheDocument();
    // Most recent conversation first
    expect(screen.getByText("远程端显示异常排查")).toBeInTheDocument();
  });

  it("fuzzy-filters items by query and hides non-matching groups", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("搜索会话、工作区或执行动作…");
    fireEvent.change(input, { target: { value: "翻译" } });
    expect(screen.getByText("翻译软件重构")).toBeInTheDocument();
    expect(screen.queryByText("远程端显示异常排查")).toBeNull();
    expect(screen.queryByText("新建对话")).toBeNull();
  });

  it("supports keywords matching for actions", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("搜索会话、工作区或执行动作…");
    fireEvent.change(input, { target: { value: "term" } });
    expect(screen.getByText("打开终端")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("搜索会话、工作区或执行动作…"), {
      target: { value: "zzzz不存在zzzz" },
    });
    expect(screen.getByText("没有匹配的结果")).toBeInTheDocument();
  });

  it("navigates with arrow keys and runs the selected action on Enter", () => {
    const run = vi.fn();
    renderPalette({
      actions: [{ ...actions[0], run }],
    });
    const input = screen.getByPlaceholderText("搜索会话、工作区或执行动作…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" }); // wraps back to index 0
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("selects a conversation on Enter and closes", async () => {
    const { onSelectConversation, onClose } = renderPalette();
    const input = screen.getByPlaceholderText("搜索会话、工作区或执行动作…");
    fireEvent.change(input, { target: { value: "异常排查" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectConversation).toHaveBeenCalledWith("conv-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("selects a workspace on click and closes", () => {
    const { onSelectWorkspace, onClose } = renderPalette();
    fireEvent.click(screen.getByText("workspace-b"));
    expect(onSelectWorkspace).toHaveBeenCalledWith("file:///ws/b");
    expect(onClose).toHaveBeenCalled();
  });
});

// ── Context menu ──

function TestContextMenuHost() {
  const ctx = useContextMenu();
  return (
    <div
      data-testid="host"
      onContextMenu={(e) =>
        ctx.openFromMouse(e, [
          { key: "copy", label: "复制全文", onSelect: () => {} },
          { key: "delete", label: "删除", danger: true, dividerBefore: true, onSelect: () => {} },
        ])
      }
    >
      host
      {ctx.menu}
    </div>
  );
}

describe("useContextMenu", () => {
  const originalMatch = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatch;
  });

  function mockPointerFine(fine: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: fine,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it("opens the menu on right click for pointer-fine devices", () => {
    mockPointerFine(true);
    render(<TestContextMenuHost />);
    fireEvent.contextMenu(screen.getByTestId("host"), { clientX: 100, clientY: 200 });
    expect(screen.getByText("复制全文")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("does not open on touch-only devices (mobile long-press unaffected)", () => {
    mockPointerFine(false);
    render(<TestContextMenuHost />);
    fireEvent.contextMenu(screen.getByTestId("host"), { clientX: 100, clientY: 200 });
    expect(screen.queryByText("复制全文")).toBeNull();
  });

  it("closes on Escape", () => {
    mockPointerFine(true);
    render(<TestContextMenuHost />);
    fireEvent.contextMenu(screen.getByTestId("host"), { clientX: 100, clientY: 200 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("复制全文")).toBeNull();
  });

  it("runs onSelect and closes when an item is clicked", () => {
    mockPointerFine(true);
    let selected = false;
    function Host() {
      const ctx = useContextMenu();
      return (
        <div
          data-testid="host"
          onContextMenu={(e) =>
            ctx.openFromMouse(e, [
              { key: "copy", label: "复制全文", onSelect: () => { selected = true; } },
            ])
          }
        >
          host
          {ctx.menu}
        </div>
      );
    }
    render(<Host />);
    fireEvent.contextMenu(screen.getByTestId("host"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText("复制全文"));
    expect(selected).toBe(true);
    expect(screen.queryByText("复制全文")).toBeNull();
  });
});

// ── Recents (最近) group ──

describe("CommandPalette recents", () => {
  it("pins resolvable recents under a 最近 group without duplicating later groups", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        actions={actions}
        conversations={conversations}
        workspaces={workspaces}
        onSelectConversation={vi.fn()}
        onSelectWorkspace={vi.fn()}
        recents={[
          { kind: "action", id: "terminal" },
          { kind: "conversation", id: "conv-2" },
        ]}
      />,
    );
    expect(screen.getByText("最近")).toBeInTheDocument();
    // The recent action appears exactly once (in 最近, excluded from 动作)
    expect(screen.getAllByText("打开终端")).toHaveLength(1);
    // The recent conversation appears exactly once (excluded from 会话 defaults)
    expect(screen.getAllByText("翻译软件重构")).toHaveLength(1);
    // 动作 group still shows after the recents block
    expect(screen.getByText("动作")).toBeInTheDocument();
  });

  it("skips unresolvable recents (deleted conversation / unknown action)", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        actions={actions}
        conversations={conversations}
        workspaces={workspaces}
        onSelectConversation={vi.fn()}
        onSelectWorkspace={vi.fn()}
        recents={[
          { kind: "conversation", id: "conv-deleted" },
          { kind: "action", id: "no-such-action" },
        ]}
      />,
    );
    expect(screen.queryByText("最近")).toBeNull();
    // Default groups unaffected
    expect(screen.getByText("动作")).toBeInTheDocument();
    expect(screen.getByText("打开终端")).toBeInTheDocument();
  });

  it("reports executed entries through onExecute", () => {
    const onExecute = vi.fn();
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        actions={actions}
        conversations={conversations}
        workspaces={workspaces}
        onSelectConversation={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onExecute={onExecute}
      />,
    );
    const input = screen.getByPlaceholderText("搜索会话、工作区或执行动作…");
    fireEvent.change(input, { target: { value: "terminal" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith({ kind: "action", id: "terminal" });
  });

  it("does not show the recents group when a query is typed", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        actions={actions}
        conversations={conversations}
        workspaces={workspaces}
        onSelectConversation={vi.fn()}
        onSelectWorkspace={vi.fn()}
        recents={[{ kind: "action", id: "terminal" }]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("搜索会话、工作区或执行动作…"), {
      target: { value: "打开" },
    });
    expect(screen.queryByText("最近")).toBeNull();
    expect(screen.getByText("打开终端")).toBeInTheDocument();
  });
});
