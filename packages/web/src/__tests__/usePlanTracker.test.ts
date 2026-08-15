import { describe, it, expect } from "vitest";
import { extractEmoji, parseTasksFromMarkdown, extractPlanFromSteps, extractSubagentStatsFromSteps } from "../hooks/usePlanTracker";
import type { TrajectoryStep } from "../types";

describe("usePlanTracker logic & markdown parsing", () => {
  it("extracts emoji and clean titles correctly", () => {
    const r1 = extractEmoji("🔧 后端Bug修复: reorderTask逻辑 + 限流中间件");
    expect(r1.icon).toBe("🔧");
    expect(r1.cleanTitle).toBe("后端Bug修复: reorderTask逻辑 + 限流中间件");

    const r2 = extractEmoji("💎 前端打磨: 骨架屏+防抖节流+错误 Toast");
    expect(r2.icon).toBe("💎");
    expect(r2.cleanTitle).toBe("前端打磨: 骨架屏+防抖节流+错误 Toast");

    const r3 = extractEmoji("纯文本任务描述");
    expect(r3.icon).toBeUndefined();
    expect(r3.cleanTitle).toBe("纯文本任务描述");
  });

  it("parses complex implementation plan markdown with steps", () => {
    const md = `# 系统特性开发方案

## 实施步骤
- [x] 🔧 基础数据库迁移与 Schema 扩展
- [ ] 🧪 后端Vitest测试套件: 25+测试覆盖所有服务
- [ ] 🔔 通知提醒系统 (后端+前端)
- [ ] 📎 附件支持系统 (后端+前端)
- [ ] 📅 日历视图系统 (后端+前端)
- [ ] 💎 前端打磨: 骨架屏+防抖节流+错误 Toast
`;

    const parsed = parseTasksFromMarkdown(md);
    expect(parsed.title).toBe("系统特性开发方案");
    expect(parsed.tasks.length).toBe(6);

    expect(parsed.tasks[0].status).toBe("completed");
    expect(parsed.tasks[0].title).toBe("基础数据库迁移与 Schema 扩展");

    // First pending becomes running
    expect(parsed.tasks[1].status).toBe("running");
    expect(parsed.tasks[1].icon).toBe("🧪");

    expect(parsed.tasks[2].status).toBe("pending");
    expect(parsed.tasks[2].icon).toBe("🔔");
  });

  it("extracts plan from steps with write_to_file toolCall", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "write_to_file",
            args: {
              TargetFile: "C:/Users/.gemini/antigravity/brain/abc/implementation_plan.md",
              CodeContent: `# 架构重构计划\n\n- [x] 🔧 步骤一\n- [ ] 🧪 步骤二`,
            },
          },
        },
      },
    ];

    const extracted = extractPlanFromSteps(mockSteps);
    expect(extracted.content).toContain("# 架构重构计划");
    expect(extracted.tasks.length).toBe(2);
    expect(extracted.tasks[0].title).toBe("步骤一");
  });

  it("extracts subagent statistics from steps", () => {
    const mockSteps: TrajectoryStep[] = [
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                { Role: "Researcher", Prompt: "Search docs", TypeName: "research" },
                { Role: "Tester", Prompt: "Run tests", TypeName: "tester" },
              ],
            },
          },
        },
      },
      {
        type: "PLANNER_RESPONSE",
        status: "DONE",
        metadata: {
          toolCall: {
            name: "invoke_subagent",
            args: {
              Subagents: [
                { Role: "Builder", Prompt: "Build feature", TypeName: "builder" },
              ],
            },
          },
        },
      },
    ];

    const stats = extractSubagentStatsFromSteps(mockSteps);
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(3);
  });
});

