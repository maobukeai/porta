/**
 * /api/commands route — returns dynamic list of installed slash commands, skills, plugins, and MCP tools
 */

import type { Hono } from "hono";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CommandItem {
  name: string;
  desc: string;
  category?: "slash" | "skill" | "plugin" | "mcp";
}

const BUILTIN_COMMANDS: CommandItem[] = [
  {
    name: "btw",
    desc: "不中断主对话的情况下快速提问",
    category: "slash",
  },
  {
    name: "goal",
    desc: "持续运行直至完全完成指定的开发目标",
    category: "slash",
  },
  {
    name: "schedule",
    desc: "按周期定时计划或一次性定时器运行指令",
    category: "slash",
  },
  {
    name: "browser",
    desc: "调用浏览器 Agent 执行网页任务",
    category: "slash",
  },
  {
    name: "grill-me",
    desc: "通过交互对话对齐并确认实施计划",
    category: "slash",
  },
  {
    name: "teamwork-preview",
    desc: "调用多智能体团队协同解决大型项目",
    category: "slash",
  },
  {
    name: "learn",
    desc: "总结复盘近期经验并沉淀为可复用技能",
    category: "slash",
  },
];

function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const text = match[1];
  const nameMatch = text.match(/name:\s*["']?([^"'\r\n]+)["']?/);
  const descMatch = text.match(/description:\s*["']?([^"'\r\n]+)["']?/);
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  };
}

function scanSkillDir(baseDir: string, category: "skill" | "plugin" = "skill"): CommandItem[] {
  const items: CommandItem[] = [];
  if (!existsSync(baseDir)) return items;

  try {
    const entries = readdirSync(baseDir);
    for (const entry of entries) {
      const fullPath = join(baseDir, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      let skillMdPath = join(fullPath, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        // Check plugins sub-skills
        const pluginSkillDir = join(fullPath, "skills");
        if (existsSync(pluginSkillDir) && statSync(pluginSkillDir).isDirectory()) {
          items.push(...scanSkillDir(pluginSkillDir, "plugin"));
        }
        continue;
      }

      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const parsed = parseFrontmatter(content);
        if (parsed && parsed.name) {
          items.push({
            name: parsed.name,
            desc: parsed.description ?? `${entry} skill`,
            category,
          });
        } else {
          items.push({
            name: entry,
            desc: `${entry} skill`,
            category,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Skip unreadable dirs
  }

  return items;
}

function scanMcpDir(): CommandItem[] {
  const items: CommandItem[] = [];
  const mcpDir = join(homedir(), ".gemini", "antigravity", "mcp");
  if (!existsSync(mcpDir)) return items;

  try {
    const servers = readdirSync(mcpDir);
    for (const server of servers) {
      const serverPath = join(mcpDir, server);
      if (!statSync(serverPath).isDirectory()) continue;
      const files = readdirSync(serverPath);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const toolName = file.replace(/\.json$/, "");
          items.push({
            name: `mcp:${server}:${toolName}`,
            desc: `${server} 提供的 MCP 工具`,
            category: "mcp",
          });
        }
      }
    }
  } catch {
    // Skip on error
  }

  return items;
}

export function registerCommandRoutes(app: Hono): void {
  app.get("/api/commands", (c) => {
    const home = homedir();
    const userSkillsDir = join(home, ".gemini", "config", "skills");
    const builtinSkillsDir = join(home, ".gemini", "antigravity", "builtin", "skills");
    const pluginsDir = join(home, ".gemini", "config", "plugins");

    const userSkills = scanSkillDir(userSkillsDir, "skill");
    const builtinSkills = scanSkillDir(builtinSkillsDir, "skill");
    const plugins = scanSkillDir(pluginsDir, "plugin");
    const mcpTools = scanMcpDir();

    // Map to prevent duplicate command names
    const map = new Map<string, CommandItem>();

    for (const item of BUILTIN_COMMANDS) {
      map.set(item.name, item);
    }
    for (const item of [...userSkills, ...builtinSkills, ...plugins, ...mcpTools]) {
      if (!map.has(item.name)) {
        map.set(item.name, item);
      }
    }

    const commands = Array.from(map.values());
    return c.json({ commands });
  });
}
