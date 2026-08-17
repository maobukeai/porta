import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../components/Sidebar";
import type { ConversationEntry } from "../hooks/useConversations";

describe("Sidebar collapse and expand all conversations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const mockConversations: ConversationEntry[] = [
    {
      id: "conv-1",
      summary: {
        summary: "修复登录界面 Bug",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_IDLE",
        stepCount: 1,
        trajectoryId: "traj-1",
        projectName: "项目A",
        workspaces: [],
      },
    },
    {
      id: "conv-2",
      summary: {
        summary: "优化图片上传性能",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_IDLE",
        stepCount: 1,
        trajectoryId: "traj-2",
        projectName: "项目B",
        workspaces: [],
      },
    },
  ];

  it("renders with collapse all button initially when groups are open", () => {
    render(
      <Sidebar
        conversations={mockConversations}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    // Both conversation titles should be visible initially
    expect(screen.getByText("修复登录界面 Bug")).toBeInTheDocument();
    expect(screen.getByText("优化图片上传性能")).toBeInTheDocument();

    // The collapse button should have title '收起全部'
    const collapseBtn = screen.getByTitle("收起全部");
    expect(collapseBtn).toBeInTheDocument();

    // Clicking it should collapse all groups
    fireEvent.click(collapseBtn);

    // Conversations should now be hidden
    expect(screen.queryByText("修复登录界面 Bug")).not.toBeInTheDocument();
    expect(screen.queryByText("优化图片上传性能")).not.toBeInTheDocument();

    // The button title should have switched to '展开全部'
    const expandBtn = screen.getByTitle("展开全部");
    expect(expandBtn).toBeInTheDocument();

    // Clicking expand all should show the conversations again
    fireEvent.click(expandBtn);
    expect(screen.getByText("修复登录界面 Bug")).toBeInTheDocument();
    expect(screen.getByText("优化图片上传性能")).toBeInTheDocument();
    expect(screen.getByTitle("收起全部")).toBeInTheDocument();
  });

  it("toggles single group when group header is clicked", () => {
    render(
      <Sidebar
        conversations={mockConversations}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    // Click group header "项目A"
    const groupAHeader = screen.getByText("项目A");
    fireEvent.click(groupAHeader);

    // conv-1 hidden, conv-2 still visible
    expect(screen.queryByText("修复登录界面 Bug")).not.toBeInTheDocument();
    expect(screen.getByText("优化图片上传性能")).toBeInTheDocument();

    // Still has '收起全部' because not all groups are collapsed
    const collapseBtn = screen.getByTitle("收起全部");
    expect(collapseBtn).toBeInTheDocument();

    // Now click group header "项目B"
    const groupBHeader = screen.getByText("项目B");
    fireEvent.click(groupBHeader);

    // Both are now collapsed -> button becomes '展开全部'
    expect(screen.queryByText("优化图片上传性能")).not.toBeInTheDocument();
    expect(screen.getByTitle("展开全部")).toBeInTheDocument();
  });

  it("pins the 任务 group permanently at the bottom below other project folders", () => {
    const mixedConversations: ConversationEntry[] = [
      {
        id: "conv-scratch-1",
        summary: {
          summary: "临时探索任务",
          lastModifiedTime: new Date(Date.now() + 10000).toISOString(),
          createdTime: new Date().toISOString(),
          status: "CASCADE_RUN_STATUS_RUNNING",
          stepCount: 1,
          trajectoryId: "traj-scratch",
          workspaces: [],
        },
      },
      {
        id: "conv-proj-1",
        summary: {
          summary: "前端界面优化",
          lastModifiedTime: new Date(Date.now() - 50000).toISOString(),
          createdTime: new Date().toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 2,
          trajectoryId: "traj-p1",
          projectName: "PortalWeb",
          workspaces: [],
        },
      },
      {
        id: "conv-proj-2",
        summary: {
          summary: "后端网关修复",
          lastModifiedTime: new Date(Date.now() - 60000).toISOString(),
          createdTime: new Date().toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "traj-p2",
          projectName: "Gateway",
          workspaces: [],
        },
      },
    ];

    render(
      <Sidebar
        conversations={mixedConversations}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByText("其他")).not.toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    expect(screen.getByText("PortalWeb")).toBeInTheDocument();
    expect(screen.getByText("Gateway")).toBeInTheDocument();

    const groupNameElements = document.querySelectorAll(".zcode-tree-folder-name");
    const groupNames = Array.from(groupNameElements).map((el) => el.textContent?.trim());

    expect(groupNames).toEqual(["PortalWeb", "Gateway", "任务"]);
  });

  it("supports dragging to reorder workspace groups and persists custom order", () => {
    const dragConversations: ConversationEntry[] = [
      {
        id: "c1",
        summary: {
          summary: "任务1",
          lastModifiedTime: new Date("2026-08-14T12:00:00Z").toISOString(),
          createdTime: new Date("2026-08-14T12:00:00Z").toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "t1",
          projectName: "项目A",
          workspaces: [],
        },
      },
      {
        id: "c2",
        summary: {
          summary: "任务2",
          lastModifiedTime: new Date("2026-08-14T11:00:00Z").toISOString(),
          createdTime: new Date("2026-08-14T11:00:00Z").toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "t2",
          projectName: "项目B",
          workspaces: [],
        },
      },
      {
        id: "c3",
        summary: {
          summary: "任务3",
          lastModifiedTime: new Date("2026-08-14T10:00:00Z").toISOString(),
          createdTime: new Date("2026-08-14T10:00:00Z").toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "t3",
          projectName: "项目C",
          workspaces: [],
        },
      },
    ];

    render(
      <Sidebar
        conversations={dragConversations}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    const groupContainers = document.querySelectorAll(".zcode-tree-group");
    const headerRows = document.querySelectorAll(".zcode-tree-header-row");
    const conversationItems = document.querySelectorAll(".zcode-tree-item");

    expect(groupContainers.length).toBe(3);
    expect(headerRows.length).toBe(3);
    expect(conversationItems.length).toBe(3);

    // Conversation items should NOT be draggable
    expect(conversationItems[0].getAttribute("draggable")).toBe("false");

    // Header rows should be draggable
    expect(headerRows[0].getAttribute("draggable")).toBe("true");

    // Drag 项目A header row over 项目C group container
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(),
      effectAllowed: "move",
      dropEffect: "move",
    };

    fireEvent.dragStart(headerRows[0], { dataTransfer });
    fireEvent.dragOver(groupContainers[2], {
      dataTransfer,
      clientY: 100,
    });
    fireEvent.drop(groupContainers[2], { dataTransfer });

    const reorderedGroupNames = Array.from(
      document.querySelectorAll(".zcode-tree-folder-name"),
    ).map((el) => el.textContent?.trim());

    // Project A dropped on Project C
    expect(reorderedGroupNames[0]).toBe("项目B");
    expect(localStorage.getItem("porta:sidebarGroupOrder_v1")).toBeDefined();
  });

  it("displays amber pulsating waiting indicator when conversation requires user input", () => {
    localStorage.setItem("porta:waitingTasks_v1", JSON.stringify(["conv-1"]));

    render(
      <Sidebar
        conversations={mockConversations}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByTitle("等待选择确认 (点击进入对话)")).toBeInTheDocument();
    expect(screen.getByTitle("文件夹内有等待您选择/确认的任务")).toBeInTheDocument();
  });

  it("triggers onNew with workspaceUri when clicking the new task button on a folder", () => {
    const mockOnNew = vi.fn();
    const convsWithUri: ConversationEntry[] = [
      {
        id: "conv-1",
        summary: {
          summary: "修复登录界面 Bug",
          lastModifiedTime: new Date().toISOString(),
          createdTime: new Date().toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "traj-1",
          projectName: "项目A",
          workspaces: [
            {
              workspaceFolderAbsoluteUri: "file:///c:/Users/projects/project-a",
            },
          ],
        },
      },
    ];

    render(
      <Sidebar
        conversations={convsWithUri}
        activeId={null}
        onSelect={vi.fn()}
        onNew={mockOnNew}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    const newBtn = screen.getByTitle("在「项目A」中新建任务");
    expect(newBtn).toBeInTheDocument();

    fireEvent.click(newBtn);
    expect(mockOnNew).toHaveBeenCalledWith("file:///c:/Users/projects/project-a");
  });

  it("triggers onNew with null when clicking new task button on the standalone 任务 group", () => {
    const mockOnNew = vi.fn();
    const taskConvs: ConversationEntry[] = [
      {
        id: "conv-task-1",
        summary: {
          summary: "通用对话",
          lastModifiedTime: new Date().toISOString(),
          createdTime: new Date().toISOString(),
          status: "CASCADE_RUN_STATUS_IDLE",
          stepCount: 1,
          trajectoryId: "traj-task-1",
          projectName: "任务",
          workspaces: [],
        },
      },
    ];

    render(
      <Sidebar
        conversations={taskConvs}
        activeId={null}
        onSelect={vi.fn()}
        onNew={mockOnNew}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );

    const taskNewBtn = screen.getByTitle("新建独立任务 (不关联项目)");
    expect(taskNewBtn).toBeInTheDocument();

    fireEvent.click(taskNewBtn);
    expect(mockOnNew).toHaveBeenCalledWith(null);
  });
});

describe("Sidebar inline type-to-filter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const filterConvs: ConversationEntry[] = [
    {
      id: "conv-f1",
      summary: {
        summary: "修复登录界面 Bug",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_IDLE",
        stepCount: 1,
        trajectoryId: "traj-f1",
        projectName: "项目A",
        workspaces: [],
      },
    },
    {
      id: "conv-f2",
      summary: {
        summary: "优化图片上传性能",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_IDLE",
        stepCount: 1,
        trajectoryId: "traj-f2",
        projectName: "项目B",
        workspaces: [],
      },
    },
  ];

  function renderSidebar() {
    return render(
      <Sidebar
        conversations={filterConvs}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );
  }

  it("filters conversations by title as you type and shows the match count", () => {
    renderSidebar();
    const input = screen.getByPlaceholderText("筛选会话…");
    fireEvent.change(input, { target: { value: "登录" } });

    expect(screen.getByText("修复登录界面 Bug")).toBeInTheDocument();
    expect(screen.queryByText("优化图片上传性能")).toBeNull();
    // The sidebar also renders group-count chips ("1"), so scope to the filter badge
    const badge = document.querySelector(".porta-sidebar-filter-count");
    expect(badge?.textContent).toBe("1");
  });

  it("matches case-insensitively and by workspace group name", () => {
    renderSidebar();
    const input = screen.getByPlaceholderText("筛选会话…");
    fireEvent.change(input, { target: { value: "项目b" } });

    expect(screen.getByText("优化图片上传性能")).toBeInTheDocument();
    expect(screen.queryByText("修复登录界面 Bug")).toBeNull();
  });

  it("shows the empty state and clears via the reset button", () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText("筛选会话…"), {
      target: { value: "zzz不存在zzz" },
    });
    expect(screen.getByText("没有匹配的会话")).toBeInTheDocument();

    fireEvent.click(screen.getByText("清除筛选"));
    expect(screen.getByText("修复登录界面 Bug")).toBeInTheDocument();
    expect(screen.getByText("优化图片上传性能")).toBeInTheDocument();
  });

  it("clears the filter on Escape in the input", () => {
    renderSidebar();
    const input = screen.getByPlaceholderText("筛选会话…");
    fireEvent.change(input, { target: { value: "性能" } });
    expect(screen.queryByText("修复登录界面 Bug")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("修复登录界面 Bug")).toBeInTheDocument();
  });
});

describe("Sidebar status quick-filters (只看运行中/只看未读)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const statusConvs: ConversationEntry[] = [
    {
      id: "conv-run",
      summary: {
        summary: "正在执行的任务",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_RUNNING",
        stepCount: 1,
        trajectoryId: "traj-run",
        projectName: "项目S",
        workspaces: [],
      },
    },
    {
      id: "conv-idle",
      summary: {
        summary: "空闲的普通任务",
        lastModifiedTime: new Date().toISOString(),
        createdTime: new Date().toISOString(),
        status: "CASCADE_RUN_STATUS_IDLE",
        stepCount: 1,
        trajectoryId: "traj-idle",
        projectName: "项目S",
        workspaces: [],
      },
    },
  ];

  function renderSidebar() {
    return render(
      <Sidebar
        conversations={statusConvs}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
        loading={false}
        connected={true}
        isOpen={true}
        onToggle={vi.fn()}
      />,
    );
  }

  function openPopover() {
    fireEvent.click(screen.getByTitle("视图与排序方式"));
  }

  it("filters to running conversations via the popover toggle", () => {
    renderSidebar();
    openPopover();
    fireEvent.click(screen.getByTitle(/仅显示正在执行任务的会话/));

    expect(screen.getByText("正在执行的任务")).toBeInTheDocument();
    expect(screen.queryByText("空闲的普通任务")).toBeNull();
    // Active chip appears and the choice persists
    expect(screen.getByTitle("关闭「只看运行中」过滤")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("porta:sidebarStatusFilter") as string)).toEqual({
      running: true,
      unread: false,
    });
  });

  it("removing the chip restores the full list", () => {
    renderSidebar();
    openPopover();
    fireEvent.click(screen.getByTitle(/仅显示正在执行任务的会话/));
    fireEvent.click(screen.getByTitle("关闭「只看运行中」过滤"));

    expect(screen.getByText("正在执行的任务")).toBeInTheDocument();
    expect(screen.getByText("空闲的普通任务")).toBeInTheDocument();
  });

  it("combines running and unread filters", () => {
    // Mark the idle conv as unread-completed
    localStorage.setItem("porta_unread_completed_tasks_v1", JSON.stringify(["conv-idle"]));
    renderSidebar();
    openPopover();
    fireEvent.click(screen.getByTitle(/仅显示正在执行任务的会话/));
    fireEvent.click(screen.getByTitle(/仅显示有未读完成消息的会话/));

    // No conversation satisfies both conditions
    expect(screen.getByText("没有运行中的未读会话")).toBeInTheDocument();
    expect(screen.queryByText("正在执行的任务")).toBeNull();
  });

  it("unread-only filter keeps unread conversations", () => {
    localStorage.setItem("porta_unread_completed_tasks_v1", JSON.stringify(["conv-idle"]));
    renderSidebar();
    openPopover();
    fireEvent.click(screen.getByTitle(/仅显示有未读完成消息的会话/));

    expect(screen.getByText("空闲的普通任务")).toBeInTheDocument();
    expect(screen.queryByText("正在执行的任务")).toBeNull();
  });
});
