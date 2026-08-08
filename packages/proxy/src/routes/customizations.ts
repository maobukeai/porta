import type { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { handleRPCError } from "../errors.js";

interface SkillInfo {
  name: string;
  description: string;
  source: "config" | "builtin" | "plugin";
}

interface McpInfo {
  name: string;
  description: string;
}

const FRIENDLY_SKILL_DESCS: Record<string, string> = {
  brainstorming: "深度头脑风暴：在动手开发前深入探索用户意图、技术架构与多维度方案设计。",
  "dispatching-parallel-agents": "并行智能体调度：当面临 2 个以上可独立运行的任务时，并行调度子智能体。",
  "executing-plans": "计划执行器：按实施步骤逐项验收并推进大型开发里程碑。",
  "finishing-a-development-branch": "分支收尾：结构化指导代码合并、PR 提交与环境清理。",
  frontend_design: "前端极致设计：构建兼具高端设计感与生产级别的独特前端界面，避开平庸排版。",
  "receiving-code-review": "代码评审接收：严谨校验代码评审反馈，推导技术修改点。",
  "requesting-code-review": "代码评审请求：验证开发工作完全符合规格要求并请求代码审查。",
  "subagent-driven-development": "子代理并行开发：多任务并行调度独立子智能体，执行无状态依赖的复合规划。",
  superpowers: "超级超能力：系统级头脑风暴与大型架构拆解评估。",
  "systematic-debugging": "系统化调试：严密追溯 Bug 根因，系统化推导代码修复与防御策略。",
  "test-driven-development": "测试驱动开发：在实现新功能前编写严格的断言与单元测试逻辑。",
  "ui-ux-pro-max": "UI/UX 极致设计：内置 50+ 风格、161+ 色板、57+ 字体与 99+ 条核心设计指南。",
  "using-git-worktrees": "隔离工作区：创建与当前工作区隔离的干净 Git 工作区。",
  "using-superpowers": "开启超能力：规范技能调度与超能力使用流程。",
  "verification-before-completion": "完工验证：强制运行验证命令并确认输出，杜绝盲目声明完成。",
  "writing-plans": "编写计划：面对复杂需求编写系统化实施计划文档。",
  "writing-skills": "编写技能：创建、编辑与测试新技能定义文件。",
  "agy-customizations": "AGY 自定义与扩展：Antigravity 技能、规则、侧边栏与 MCP 配置总览。",
  antigravity_guide: "Antigravity 使用指南：全套 IDE 2.0+ 与 agy CLI 指南和速查表。",
  "permissioned-github": "GitHub 授权服务：安全执行 GitHub API 与仓库操作。",
};

const FRIENDLY_MCP_DESCS: Record<string, string> = {
  "blender-mcp": "Blender 3D 资产建模、渲染调度、Polyhaven 与 Sketchfab 模型检索集成。",
  "chrome-devtools-mcp": "Chrome DevTools 原生自动化网页交互、DOM 检查与 Console 审查。",
  chrome_devtools: "Chrome DevTools 浏览器控制通道。",
  "eagle-mcp": "Eagle 设计资源库与素材管理集成。",
  "github-mcp-server": "GitHub 仓库检索、分支建立、PR 自动创建与代码合并自动化。",
  "prisma-mcp-server": "Prisma 数据库迁移状态监控与 Prisma Studio 调试可视化。",
  "sequential-thinking": "Sequential Thinking 顺序思考与复杂逻辑推理引擎。",
  StitchMCP: "Stitch UI 设计稿自动缝合与代码转换引擎。",
  "videostudio-tutorial": "自动化视频教程录制、片段合成与渲染流水线。",
};

async function scanSkills(dir: string, source: "config" | "builtin"): Promise<SkillInfo[]> {
  const result: SkillInfo[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const name = entry.name;
        let desc = FRIENDLY_SKILL_DESCS[name] ?? "";
        if (!desc) {
          try {
            const content = await readFile(join(dir, name, "SKILL.md"), "utf-8");
            const match = content.match(/description:\s*(.+)/i) ?? content.match(/^#\s*(.+)/m);
            if (match && match[1]) {
              desc = match[1].trim().replace(/^["']|["']$/g, "");
            }
          } catch {
            // fallback if SKILL.md unreadable
          }
        }
        result.push({
          name,
          description: desc || `Antigravity ${source === "builtin" ? "内置" : "扩展"}技能`,
          source,
        });
      }
    }
  } catch {
    // Dir doesn't exist
  }
  return result;
}

async function scanMcp(dir: string): Promise<McpInfo[]> {
  const result: McpInfo[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const name = entry.name;
        const desc = FRIENDLY_MCP_DESCS[name] ?? `MCP 服务器工具 (${name})`;
        result.push({ name, description: desc });
      }
    }
  } catch {
    // Dir doesn't exist
  }
  return result;
}

export function registerCustomizationsRoutes(app: Hono): void {
  app.get("/api/customizations", async (c) => {
    try {
      const configSkillsDir = join(homedir(), ".gemini", "config", "skills");
      const builtinSkillsDir = join(homedir(), ".gemini", "antigravity", "builtin", "skills");
      const mcpDir = join(homedir(), ".gemini", "antigravity", "mcp");

      const [configSkills, builtinSkills, mcpServers] = await Promise.all([
        scanSkills(configSkillsDir, "config"),
        scanSkills(builtinSkillsDir, "builtin"),
        scanMcp(mcpDir),
      ]);

      const allSkills = [...configSkills, ...builtinSkills];
      return c.json({
        skills: allSkills,
        mcpServers,
        count: {
          skills: allSkills.length,
          mcpServers: mcpServers.length,
        },
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
