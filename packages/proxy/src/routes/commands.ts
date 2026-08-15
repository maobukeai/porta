/**
 * /api/commands route — returns dynamic list of installed slash commands, skills, plugins, and MCP tools
 */

import type { Hono } from "hono";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
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

function parseYamlFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) return { data: {}, body: content.trim() };

  const frontmatterStr = match[1];
  const body = match[2].trim();
  const data: Record<string, string> = {};

  const lines = frontmatterStr.split(/\r?\n/);
  let currentKey = "";

  for (const line of lines) {
    const keyVal = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyVal) {
      currentKey = keyVal[1];
      const val = keyVal[2].trim();
      if (val === ">-" || val === ">" || val === "|") {
        data[currentKey] = "";
      } else {
        data[currentKey] = val.replace(/^["']|["']$/g, "");
      }
    } else if (currentKey && line.startsWith("  ")) {
      const additional = line.trim();
      if (typeof data[currentKey] === "string") {
        data[currentKey] = (data[currentKey] + " " + additional).trim();
      }
    }
  }

  return { data, body };
}

function scanSkillDir(baseDir: string, category: "skill" | "plugin" = "skill"): CommandItem[] {
  const items: CommandItem[] = [];
  if (!existsSync(baseDir)) return items;

  // Direct skill folder (has SKILL.md directly inside baseDir)
  const directSkillMd = join(baseDir, "SKILL.md");
  if (existsSync(directSkillMd)) {
    try {
      const content = readFileSync(directSkillMd, "utf-8");
      const { data } = parseYamlFrontmatter(content);
      const dirName = basename(baseDir);
      const name = data.name || dirName;
      items.push({
        name,
        desc: data.description || `${name} skill`,
        category,
      });
    } catch {}
    return items;
  }

  try {
    const entries = readdirSync(baseDir);
    for (const entry of entries) {
      const fullPath = join(baseDir, entry);
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir || entry.startsWith(".")) continue;

      const skillMdPath = join(fullPath, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        // Check plugins sub-skills
        const pluginSkillDir = join(fullPath, "skills");
        if (existsSync(pluginSkillDir)) {
          try {
            if (statSync(pluginSkillDir).isDirectory()) {
              items.push(...scanSkillDir(pluginSkillDir, "plugin"));
            }
          } catch {}
        }
        continue;
      }

      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const { data } = parseYamlFrontmatter(content);
        const name = data.name || entry;
        items.push({
          name,
          desc: data.description || `${name} skill`,
          category,
        });

        // If skill name has Chinese suffix like `brainstorming-头脑风暴`, also add pure English alias if distinct
        if (name.includes("-")) {
          const parts = name.split("-");
          const alias = parts[0].trim();
          if (alias && alias !== name && !items.some(i => i.name === alias)) {
            items.push({
              name: alias,
              desc: data.description || `${alias} skill`,
              category,
            });
          }
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

function scanCustomCommandsDir(baseDir: string): CommandItem[] {
  const items: CommandItem[] = [];
  if (!existsSync(baseDir)) return items;

  try {
    const files = readdirSync(baseDir);
    for (const file of files) {
      if (!file.endsWith(".md") && !file.endsWith(".toml")) continue;
      const fullPath = join(baseDir, file);
      const cmdName = file.replace(/\.(md|toml)$/, "");
      try {
        const content = readFileSync(fullPath, "utf-8");
        const { data } = parseYamlFrontmatter(content);
        items.push({
          name: cmdName,
          desc: data.description ?? `自定义命令 /${cmdName}`,
          category: "slash",
        });
      } catch {
        items.push({
          name: cmdName,
          desc: `自定义命令 /${cmdName}`,
          category: "slash",
        });
      }
    }
  } catch {}

  return items;
}

export function registerCommandRoutes(app: Hono): void {
  app.get("/api/commands", (c) => {
    const home = homedir();
    const rawWorkspace = c.req.query("workspaceUri");
    let workspaceDir: string | null = null;
    if (rawWorkspace) {
      workspaceDir = rawWorkspace.startsWith("file://")
        ? decodeURIComponent(rawWorkspace.replace(/^file:\/\/\/?/, ""))
        : rawWorkspace;
    }

    const userCommands1 = scanCustomCommandsDir(join(home, ".agents", "commands"));
    const userCommands2 = scanCustomCommandsDir(join(home, ".gemini", "config", "commands"));
    const wsCommands1 = workspaceDir ? scanCustomCommandsDir(join(workspaceDir, ".agents", "commands")) : [];
    const wsCommands2 = workspaceDir ? scanCustomCommandsDir(join(workspaceDir, ".gemini", "commands")) : [];

    const userSkillsDir = join(home, ".gemini", "config", "skills");
    const builtinSkillsDir = join(home, ".gemini", "antigravity", "builtin", "skills");
    const pluginsDir = join(home, ".gemini", "config", "plugins");

    const userSkills = scanSkillDir(userSkillsDir, "skill");
    const builtinSkills = scanSkillDir(builtinSkillsDir, "skill");
    const plugins = scanSkillDir(pluginsDir, "plugin");
    const wsSkills1 = workspaceDir ? scanSkillDir(join(workspaceDir, ".gemini", "skills"), "skill") : [];
    const wsSkills2 = workspaceDir ? scanSkillDir(join(workspaceDir, ".agents", "skills"), "skill") : [];
    const wsSkills3 = workspaceDir ? scanSkillDir(join(workspaceDir, "skills"), "skill") : [];
    const mcpTools = scanMcpDir();

    // Map to prevent duplicate command names
    const map = new Map<string, CommandItem>();

    // 1. Built-in slash commands
    for (const item of BUILTIN_COMMANDS) {
      map.set(item.name, item);
    }
    // 2. User & Workspace custom commands
    for (const item of [...userCommands1, ...userCommands2, ...wsCommands1, ...wsCommands2]) {
      map.set(item.name, item);
    }
    // 3. Skills (user, builtin, plugins, workspace)
    for (const item of [...userSkills, ...builtinSkills, ...plugins, ...wsSkills1, ...wsSkills2, ...wsSkills3]) {
      if (!map.has(item.name)) {
        map.set(item.name, item);
      }
    }
    // 4. MCP tools
    for (const item of mcpTools) {
      if (!map.has(item.name)) {
        map.set(item.name, item);
      }
    }

    // Filter out disabled commands and disabled skills
    const configPath = join(home, ".gemini", "config", "config.json");
    let disabledSet = new Set<string>();
    if (existsSync(configPath)) {
      try {
        const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
        if (Array.isArray(cfg.disabledCommands)) {
          for (const s of cfg.disabledCommands) {
            const clean = s.startsWith("/") ? s : `/${s}`;
            disabledSet.add(clean);
            disabledSet.add(clean.slice(1));
          }
        }
        if (Array.isArray(cfg.disabledSkills)) {
          for (const s of cfg.disabledSkills) {
            disabledSet.add(s);
          }
        }
      } catch {}
    }

    const commands = Array.from(map.values()).filter((item) => {
      const slashName = item.name.startsWith("/") ? item.name : `/${item.name}`;
      return !disabledSet.has(slashName) && !disabledSet.has(item.name);
    });

    return c.json({ commands });
  });
}
