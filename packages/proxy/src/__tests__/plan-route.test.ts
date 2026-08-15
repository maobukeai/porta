import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerPlanRoutes, parsePlanMarkdown, extractEmoji } from "../routes/plan.js";

describe("Plan Routes & Parser (/api/conversations/:id/plan)", () => {
  it("extractEmoji extracts leading and embedded emojis properly", () => {
    const res1 = extractEmoji("🔧 后端Bug修复: reorderTask逻辑 + 限流中间件");
    expect(res1.icon).toBe("🔧");
    expect(res1.cleanTitle).toBe("后端Bug修复: reorderTask逻辑 + 限流中间件");

    const res2 = extractEmoji("🧪 后端Vitest测试套件: 25+测试覆盖所有服务");
    expect(res2.icon).toBe("🧪");
    expect(res2.cleanTitle).toBe("后端Vitest测试套件: 25+测试覆盖所有服务");

    const res3 = extractEmoji("普通没有表情的任务标题");
    expect(res3.icon).toBeUndefined();
    expect(res3.cleanTitle).toBe("普通没有表情的任务标题");
  });

  it("parsePlanMarkdown parses checklist tasks with status correctly", () => {
    const md = `# 任务规划总标题

## 详细步骤
- [x] 🔧 初始化基础项目结构
- [ ] 🧪 后端Vitest测试套件: 25+测试覆盖所有服务
- [ ] 🔔 通知提醒系统 (后端+前端)
- [ ] 📎 附件支持系统 (后端+前端)
- [ ] 📅 日历视图系统 (后端+前端)
- [ ] 💎 前端打磨: 骨架屏+防抖节流+错误 Toast
`;

    const parsed = parsePlanMarkdown(md);
    expect(parsed.title).toBe("任务规划总标题");
    expect(parsed.tasks.length).toBe(6);

    expect(parsed.tasks[0].title).toBe("初始化基础项目结构");
    expect(parsed.tasks[0].icon).toBe("🔧");
    expect(parsed.tasks[0].status).toBe("completed");

    // First pending after completed becomes 'running'
    expect(parsed.tasks[1].title).toBe("后端Vitest测试套件: 25+测试覆盖所有服务");
    expect(parsed.tasks[1].icon).toBe("🧪");
    expect(parsed.tasks[1].status).toBe("running");

    expect(parsed.tasks[2].title).toBe("通知提醒系统 (后端+前端)");
    expect(parsed.tasks[2].icon).toBe("🔔");
    expect(parsed.tasks[2].status).toBe("pending");
  });

  it("GET /api/conversations/:id/plan returns hasPlan=false for non-existent plans", async () => {
    const app = new Hono();
    registerPlanRoutes(app);

    const res = await app.request("/api/conversations/non-existent-conv-id-12345/plan");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasPlan).toBe(false);
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBe(0);
  });
});
