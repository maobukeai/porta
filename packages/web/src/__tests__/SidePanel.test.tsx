import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidePanel, parseConventionalCommit, getRemoteRepoLabel, formatGitRelativeTimeChinese, parseGitRefs } from "../components/SidePanel";
import type { TrajectoryStep } from "../types";

/** The desktop tab bar duplicates the picker card labels — scope lookups to the picker. */
function pickerEl(): HTMLElement {
  const el = document.querySelector(".zcode-tab-picker-container");
  if (!el) throw new Error("tab picker container not rendered");
  return el as HTMLElement;
}

describe("SidePanel Component", () => {
  it("renders tab picker empty state matching design with 3 cards", () => {
    render(<SidePanel steps={[]} messages={[]} />);
    expect(screen.getByText("打开标签页")).toBeInTheDocument();
    expect(screen.getByText("选择要在侧边面板中打开的标签。")).toBeInTheDocument();
    const picker = pickerEl();
    expect(within(picker).getByText("辅助对话")).toBeInTheDocument();
    expect(within(picker).getByText("审查")).toBeInTheDocument();
    expect(within(picker).getByText("终端")).toBeInTheDocument();
  });

  it("renders the desktop persistent tab bar with core tabs and switches 审查 via tab button", () => {
    render(<SidePanel steps={[]} messages={[]} />);
    expect(screen.getByRole("tab", { name: "辅助对话" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审查" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Git" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "终端" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "审查" }));
    expect(screen.getByText("代码审查中心")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审查" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the terminal mounted (keep-alive) when switching to another tab", async () => {
    render(<SidePanel steps={[]} messages={[]} projectName="测试项目" />);
    fireEvent.click(screen.getByRole("tab", { name: "终端" }));
    expect(await screen.findByTitle("新建终端")).toBeInTheDocument();

    // Switch to review — terminal wrapper stays mounted but hidden
    fireEvent.click(screen.getByRole("tab", { name: "审查" }));
    const keepalive = document.querySelector(".zcode-sidepanel-keepalive");
    expect(keepalive).not.toBeNull();
    expect((keepalive as HTMLElement).style.display).toBe("none");
    expect(screen.getByText("代码审查中心")).toBeInTheDocument();

    // Switch back — terminal is still alive (no re-create from scratch)
    fireEvent.click(screen.getByRole("tab", { name: "终端" }));
    expect((keepalive as HTMLElement).style.display).toBe("flex");
    expect(screen.getByTitle("新建终端")).toBeInTheDocument();
  });

  it("activates 审查 tab when clicking 审查 card and shows code review center", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_REPLACE_FILE_CONTENT",
        replaceFileContent: {
          targetFile: "src/App.tsx",
          replacementContent: "const sample = 123;",
        },
      },
    ];

    render(<SidePanel steps={mockSteps} messages={[]} />);
    const reviewCard = within(pickerEl()).getByText("审查");
    fireEvent.click(reviewCard);

    // Tab bar appears and review content shows Code Review Dashboard
    expect(screen.getByText("代码审查中心")).toBeInTheDocument();
    expect(screen.getByText("工作区代码变更")).toBeInTheDocument();
    expect(screen.getByText("const sample = 123;")).toBeInTheDocument();
  });

  it("activates Git 控制台 tab when initialTab is git and displays branch bar, commit actions, and history", () => {
    render(<SidePanel steps={[]} messages={[]} initialTab="git" />);
    expect(screen.getByText(/代码变更与 Git 控制台|代码变更与 GIT 控制台/i)).toBeInTheDocument();
    expect(screen.getByText("拉取")).toBeInTheDocument();
    expect(screen.getByText("推送")).toBeInTheDocument();
    expect(screen.getByText("提交并推送")).toBeInTheDocument();
    expect(screen.getByText("提交历史")).toBeInTheDocument();
    expect(screen.getByText("更改列表")).toBeInTheDocument();
  });

  it("activates 辅助对话 tab when clicking 辅助对话 card", () => {
    render(<SidePanel steps={[]} messages={[]} />);
    const chatCard = within(pickerEl()).getByText("辅助对话");
    fireEvent.click(chatCard);

    expect(
      screen.getByPlaceholderText(/输入辅助提问|输入辅助指令/i),
    ).toBeInTheDocument();
  });

  it("activates 终端 tab when clicking 终端 card and allows creating tabs", async () => {
    render(<SidePanel steps={[]} messages={[]} projectName="测试项目" />);
    const terminalCard = within(pickerEl()).getByText("终端");
    fireEvent.click(terminalCard);

    expect(await screen.findByTitle("新建终端")).toBeInTheDocument();
    expect(screen.getByTitle("切换面板")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked in empty state", () => {
    const onClose = vi.fn();
    render(<SidePanel steps={[]} messages={[]} onClose={onClose} />);
    const closeBtn = within(pickerEl()).getByTitle("关闭面板");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders formatted Markdown preview when opening a .md file and toggles between preview and code mode", async () => {
    const { api } = await import("../api/client");
    vi.spyOn(api, "readFileText").mockResolvedValue({
      path: "/workspace/walkthrough.md",
      content: "# 任务总结\n\n- 完成特性 1\n- 完成特性 2\n\n```ts\nconst x = 1;\n```",
    });

    render(
      <SidePanel
        steps={[]}
        messages={[]}
        initialTab="review"
        selectedFile={{
          name: "walkthrough.md",
          path: "/workspace/walkthrough.md",
          ext: "md",
        }}
      />,
    );

    // Should render the rendered markdown heading and list
    expect(await screen.findByText("任务总结")).toBeInTheDocument();
    expect(screen.getByText("完成特性 1")).toBeInTheDocument();
    expect(screen.getByText("完成特性 2")).toBeInTheDocument();

    // Has preview / source toggles
    const previewBtn = screen.getByTitle("预览渲染后的 Markdown 格式");
    const sourceBtn = screen.getByTitle("查看 Markdown 源码");
    expect(previewBtn).toBeInTheDocument();
    expect(sourceBtn).toBeInTheDocument();

    // Toggle to source mode
    fireEvent.click(sourceBtn);
    expect(await screen.findByText("# 任务总结")).toBeInTheDocument();

    // Toggle back to preview mode
    fireEvent.click(previewBtn);
    expect(await screen.findByText("完成特性 1")).toBeInTheDocument();
  });

  it("renders 子智能体目录 card in picker when subagents exist and opens SubagentDirectoryView", () => {
    const mockStepsWithSubagents: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "修复单元测试缺陷",
                  TypeName: "self",
                  Prompt: "Fix vitest bugs...",
                },
                {
                  Role: "修复SQLite并发锁问题",
                  TypeName: "self",
                  Prompt: "Fix SQLite locks...",
                },
              ],
            },
          },
        },
      },
    ];

    render(<SidePanel steps={mockStepsWithSubagents} messages={[]} />);
    expect(screen.getByText("子智能体目录 (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("子智能体目录 (2)"));
    expect(screen.getAllByText("子智能体目录").length).toBeGreaterThan(0);
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
    expect(screen.getByText("修复SQLite并发锁问题")).toBeInTheDocument();
  });

  it("shows subagents in editor tab dropdown search and allows switching", () => {
    const mockStepsWithSubagents: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "修复单元测试缺陷",
                  TypeName: "self",
                  Prompt: "Fix vitest bugs...",
                },
              ],
            },
          },
        },
      },
    ];

    render(<SidePanel steps={mockStepsWithSubagents} messages={[]} initialTab="review" />);
    const dropdownBtn = screen.getByTitle("搜索并切换标签页");
    fireEvent.click(dropdownBtn);

    expect(screen.getByText("子智能体 (1)")).toBeInTheDocument();
    expect(screen.getByText("打开子智能体目录 (1)")).toBeInTheDocument();
    expect(screen.getByText("修复单元测试缺陷")).toBeInTheDocument();
  });

  describe("Git Console Helper Functions", () => {
    it("parses conventional commit messages accurately", () => {
      const feat = parseConventionalCommit("feat(auth): add google login");
      expect(feat.isConventional).toBe(true);
      expect(feat.type).toBe("feat");
      expect(feat.scope).toBe("auth");
      expect(feat.isBreaking).toBe(false);
      expect(feat.subject).toBe("add google login");

      const breaking = parseConventionalCommit("fix(core)!: resolve critical race condition");
      expect(breaking.isConventional).toBe(true);
      expect(breaking.type).toBe("fix");
      expect(breaking.scope).toBe("core");
      expect(breaking.isBreaking).toBe(true);
      expect(breaking.subject).toBe("resolve critical race condition");

      const simple = parseConventionalCommit("docs: update README.md");
      expect(simple.isConventional).toBe(true);
      expect(simple.type).toBe("docs");
      expect(simple.scope).toBeUndefined();
      expect(simple.subject).toBe("update README.md");

      const nonConv = parseConventionalCommit("Initial commit without prefix");
      expect(nonConv.isConventional).toBe(false);
      expect(nonConv.subject).toBe("Initial commit without prefix");
    });

    it("extracts clean remote repo labels from web urls", () => {
      expect(getRemoteRepoLabel("https://github.com/maobukeai/porta")).toEqual({
        label: "GitHub: maobukeai/porta",
        host: "github",
      });
      expect(getRemoteRepoLabel("https://gitee.com/team/project.git")).toEqual({
        label: "Gitee: team/project",
        host: "gitee",
      });
      expect(getRemoteRepoLabel("https://gitlab.com/group/subgroup/repo")).toEqual({
        label: "GitLab: group/subgroup/repo",
        host: "gitlab",
      });
      expect(getRemoteRepoLabel(undefined)).toBeNull();
    });

    describe("formatGitRelativeTimeChinese", () => {
      it("calculates exact Chinese relative time from rawDate", () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);

        try {
          // < 45 seconds -> 刚刚
          expect(formatGitRelativeTimeChinese(null, new Date(now - 10 * 1000).toISOString())).toBe("刚刚");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 44 * 1000).toISOString())).toBe("刚刚");

          // < 60 minutes -> ${分钟} 分钟前
          expect(formatGitRelativeTimeChinese(null, new Date(now - 50 * 1000).toISOString())).toBe("1 分钟前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 5 * 60 * 1000).toISOString())).toBe("5 分钟前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 59 * 60 * 1000).toISOString())).toBe("59 分钟前");

          // < 24 hours -> ${小时} 小时前
          expect(formatGitRelativeTimeChinese(null, new Date(now - 60 * 60 * 1000).toISOString())).toBe("1 小时前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 12 * 3600 * 1000).toISOString())).toBe("12 小时前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 23 * 3600 * 1000).toISOString())).toBe("23 小时前");

          // < 30 days -> ${天} 天前
          expect(formatGitRelativeTimeChinese(null, new Date(now - 24 * 3600 * 1000).toISOString())).toBe("1 天前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 7 * 86400 * 1000).toISOString())).toBe("7 天前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 29 * 86400 * 1000).toISOString())).toBe("29 天前");

          // < 365 days -> ${月} 个月前
          expect(formatGitRelativeTimeChinese(null, new Date(now - 30 * 86400 * 1000).toISOString())).toBe("1 个月前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 90 * 86400 * 1000).toISOString())).toBe("3 个月前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 350 * 86400 * 1000).toISOString())).toBe("11 个月前");

          // >= 365 days -> ${年} 年前
          expect(formatGitRelativeTimeChinese(null, new Date(now - 365 * 86400 * 1000).toISOString())).toBe("1 年前");
          expect(formatGitRelativeTimeChinese(null, new Date(now - 800 * 86400 * 1000).toISOString())).toBe("2 年前");
        } finally {
          vi.restoreAllMocks();
        }
      });

      it("translates native English Git relative time strings via regex", () => {
        expect(formatGitRelativeTimeChinese("just now")).toBe("刚刚");
        expect(formatGitRelativeTimeChinese("Just now")).toBe("刚刚");
        expect(formatGitRelativeTimeChinese("1 second ago")).toBe("1 秒前");
        expect(formatGitRelativeTimeChinese("30 seconds ago")).toBe("30 秒前");
        expect(formatGitRelativeTimeChinese("1 minute ago")).toBe("1 分钟前");
        expect(formatGitRelativeTimeChinese("25 minutes ago")).toBe("25 分钟前");
        expect(formatGitRelativeTimeChinese("1 hour ago")).toBe("1 小时前");
        expect(formatGitRelativeTimeChinese("4 hours ago")).toBe("4 小时前");
        expect(formatGitRelativeTimeChinese("yesterday")).toBe("昨天");
        expect(formatGitRelativeTimeChinese("Yesterday")).toBe("昨天");
        expect(formatGitRelativeTimeChinese("1 day ago")).toBe("1 天前");
        expect(formatGitRelativeTimeChinese("5 days ago")).toBe("5 天前");
        expect(formatGitRelativeTimeChinese("1 week ago")).toBe("1 周前");
        expect(formatGitRelativeTimeChinese("3 weeks ago")).toBe("3 周前");
        expect(formatGitRelativeTimeChinese("1 month ago")).toBe("1 个月前");
        expect(formatGitRelativeTimeChinese("6 months ago")).toBe("6 个月前");
        expect(formatGitRelativeTimeChinese("1 year ago")).toBe("1 年前");
        expect(formatGitRelativeTimeChinese("2 years ago")).toBe("2 年前");
      });

      it("handles edge cases and fallback gracefully", () => {
        expect(formatGitRelativeTimeChinese(null, null)).toBe("刚刚");
        expect(formatGitRelativeTimeChinese(undefined, undefined)).toBe("刚刚");
        expect(formatGitRelativeTimeChinese("", "")).toBe("刚刚");
        expect(formatGitRelativeTimeChinese("   ")).toBe("刚刚");
        expect(formatGitRelativeTimeChinese("3 分钟前")).toBe("3 分钟前");

        // rawDate takes precedence over relativeTime if valid
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        try {
          const tenMinsAgo = new Date(now - 10 * 60 * 1000).toISOString();
          expect(formatGitRelativeTimeChinese("2 hours ago", tenMinsAgo)).toBe("10 分钟前");
        } finally {
          vi.restoreAllMocks();
        }

        // Invalid rawDate falls back to relativeTime regex translation
        expect(formatGitRelativeTimeChinese("5 hours ago", "invalid-date-format")).toBe("5 小时前");
      });
    });

    describe("parseGitRefs", () => {
      it("correctly parses git ref strings into typed tags", () => {
        const refs = "HEAD -> main, origin/main, origin/feature-1, tag: v1.0.0, bugfix";
        const parsed = parseGitRefs(refs);
        expect(parsed).toEqual([
          { type: "head", label: "main" },
          { type: "remote", label: "origin/main" },
          { type: "remote", label: "origin/feature-1" },
          { type: "tag", label: "v1.0.0" },
          { type: "branch", label: "bugfix" },
        ]);

        expect(parseGitRefs("HEAD")).toEqual([{ type: "head", label: "HEAD" }]);
        expect(parseGitRefs("")).toEqual([]);
        expect(parseGitRefs(undefined)).toEqual([]);
      });
    });
  });

  describe("Git Console Commit History Interaction", () => {
    it("renders clean commit messages and only triggers navigation when clicking GitHub button", async () => {
      const { api } = await import("../api/client");
      vi.spyOn(api, "gitStatus").mockResolvedValue({
        branch: "main",
        files: [],
        ahead: 0,
        behind: 0,
        remoteWebUrl: "https://github.com/maobukeai/porta",
      });
      vi.spyOn(api, "gitLog").mockResolvedValue({
        logs: [
          {
            hash: "d12dcf5",
            message: "feat(git): optimize git console visual styling",
            author: "Developer",
            relativeTime: "10 minutes ago",
            date: new Date().toISOString(),
            refs: "HEAD -> main, origin/main",
          },
        ],
      });

      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      render(<SidePanel steps={[]} messages={[]} initialTab="git" />);

      // Verify commit message text is rendered cleanly
      expect(await screen.findByText("feat(git): optimize git console visual styling")).toBeInTheDocument();
      expect(screen.getByText("d12dcf5")).toBeInTheDocument();
      expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("origin/main")).toBeInTheDocument();

      // Find GitHub button and commit item row
      const githubBtn = screen.getByTitle("在 GitHub 中查看此提交 (在新标签页打开)");
      expect(githubBtn).toBeInTheDocument();

      // Clicking commit row itself should NOT call window.open
      const commitMsgEl = screen.getByText("feat(git): optimize git console visual styling");
      fireEvent.click(commitMsgEl);
      expect(windowOpenSpy).not.toHaveBeenCalled();

      // Clicking GitHub button navigates
      fireEvent.click(githubBtn);
      // Link element with href or clicked
      expect(githubBtn.getAttribute("href")).toContain("d12dcf5");

      windowOpenSpy.mockRestore();
    });
  });

  it("supports controlled activeTab and fires onTabChange when switching tabs", () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      <SidePanel steps={[]} messages={[]} activeTab="chat" onTabChange={onTabChange} />
    );

    const gitTab = screen.getByRole("tab", { name: "Git" });
    fireEvent.click(gitTab);
    expect(onTabChange).toHaveBeenCalledWith("git");

    rerender(<SidePanel steps={[]} messages={[]} activeTab="git" onTabChange={onTabChange} />);
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onTabChange with null when navigating back to picker", () => {
    const onTabChange = vi.fn();
    render(<SidePanel steps={[]} messages={[]} activeTab="chat" onTabChange={onTabChange} />);
    const backBtn = screen.getByTitle("切换面板");
    fireEvent.click(backBtn);
    expect(onTabChange).toHaveBeenCalledWith(null);
  });

  it("switches to subagent tab when activeSubagentId is provided", () => {
    const onTabChange = vi.fn();
    const mockStepsWithSubagents: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                {
                  Role: "性能优化智能体",
                  TypeName: "self",
                  Prompt: "Optimize render speed...",
                },
              ],
            },
          },
        },
      },
    ];

    render(
      <SidePanel
        steps={mockStepsWithSubagents}
        messages={[]}
        activeSubagentId="性能优化智能体"
        onTabChange={onTabChange}
      />
    );
    expect(onTabChange).toHaveBeenCalledWith("subagent");
  });
});


