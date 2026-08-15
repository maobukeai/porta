/**
 * /api/agent-capabilities routes — full integration with local Antigravity system
 * Provides access to 7 core Agent capabilities:
 * 1. Memory (记忆)
 * 2. Plugins (插件)
 * 3. Skills (技能)
 * 4. Subagents (子智能体)
 * 5. MCP Servers (MCP 服务器)
 * 6. Commands (命令)
 * 7. Hooks (钩子)
 */

import type { Hono } from "hono";
import { readdir, readFile, writeFile, stat, mkdir, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { handleRPCError } from "../errors.js";

function parseYamlFrontmatter(content: string): { data: Record<string, any>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) return { data: {}, body: content.trim() };

  const frontmatterStr = match[1];
  const body = match[2].trim();
  const data: Record<string, any> = {};

  const lines = frontmatterStr.split(/\r?\n/);
  let currentKey = "";

  for (const line of lines) {
    const keyVal = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyVal) {
      currentKey = keyVal[1];
      const val = keyVal[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        data[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else if (val === ">-" || val === ">" || val === "|") {
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

function getHomeDir(): string {
  return homedir();
}

function getConfigJsonPath(): string {
  return join(getHomeDir(), ".gemini", "config", "config.json");
}

function getMcpConfigPath(): string {
  return join(getHomeDir(), ".gemini", "config", "mcp_config.json");
}

// ─────────────────────────────────────────────
// 1. Memory (记忆)
// ─────────────────────────────────────────────

export interface MemoryRecord {
  id: string;
  name: string;
  type: "global_instruction" | "workspace_rule" | "implicit_knowledge" | "learned_pattern";
  path: string;
  description: string;
  content: string;
  sizeBytes: number;
  lastModified?: string;
  isEditable: boolean;
}

async function scanMemory(workspaceUri?: string): Promise<{
  globalInstructions: MemoryRecord[];
  workspaceRules: MemoryRecord[];
  learnedMemories: MemoryRecord[];
}> {
  const home = getHomeDir();
  const globalInstructions: MemoryRecord[] = [];
  const workspaceRules: MemoryRecord[] = [];
  const learnedMemories: MemoryRecord[] = [];

  // 1. Global instruction candidates
  const globalCandidates = [
    { name: "全局 Gemini 指令 (GEMINI.md)", path: join(home, ".gemini", "GEMINI.md"), desc: "应用至所有会话与工作区的全局 Agent 行为指南" },
    { name: "全局配置规则 (config/GEMINI.md)", path: join(home, ".gemini", "config", "GEMINI.md"), desc: "全局通用配置指令与编码风格" },
    { name: "全局 Claude 指令 (CLAUDE.md)", path: join(home, ".gemini", "CLAUDE.md"), desc: "全局沉淀的高阶开发模式与偏好" },
    { name: "全局 Agent 规范 (AGENTS.md)", path: join(home, ".gemini", "AGENTS.md"), desc: "多智能体全局协作规范" },
  ];

  for (const item of globalCandidates) {
    if (existsSync(item.path)) {
      try {
        const stats = await stat(item.path);
        const content = await readFile(item.path, "utf-8");
        globalInstructions.push({
          id: `global-${basename(item.path)}`,
          name: item.name,
          type: "global_instruction",
          path: item.path,
          description: item.desc,
          content,
          sizeBytes: stats.size,
          lastModified: stats.mtime.toISOString(),
          isEditable: true,
        });
      } catch {}
    } else {
      globalInstructions.push({
        id: `global-${basename(item.path)}-stub`,
        name: `${item.name}（尚未创建）`,
        type: "global_instruction",
        path: item.path,
        description: item.desc + "。点击可立即编辑并创建此全局记忆文件。",
        content: `# Global Developer Guidelines\n\n- Write clean, maintainable code.\n- Follow best practices.`,
        sizeBytes: 0,
        isEditable: true,
      });
    }
  }

  // 2. Workspace Rules
  if (workspaceUri) {
    const cleanWorkspace = workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
    const wsCandidates = [
      { name: "工作区 GEMINI.md", path: join(cleanWorkspace, "GEMINI.md") },
      { name: "工作区 AGENTS.md", path: join(cleanWorkspace, "AGENTS.md") },
    ];
    for (const ws of wsCandidates) {
      if (existsSync(ws.path)) {
        try {
          const stats = await stat(ws.path);
          const content = await readFile(ws.path, "utf-8");
          workspaceRules.push({
            id: `ws-${basename(ws.path)}`,
            name: ws.name,
            type: "workspace_rule",
            path: ws.path,
            description: `当前工作区特定指令文件 (${cleanWorkspace})`,
            content,
            sizeBytes: stats.size,
            lastModified: stats.mtime.toISOString(),
            isEditable: true,
          });
        } catch {}
      }
    }

    const rulesDir = join(cleanWorkspace, ".agents", "rules");
    if (existsSync(rulesDir)) {
      try {
        const files = await readdir(rulesDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const p = join(rulesDir, file);
            const stats = await stat(p);
            const content = await readFile(p, "utf-8");
            workspaceRules.push({
              id: `ws-rule-${file}`,
              name: `工作区规则: ${file}`,
              type: "workspace_rule",
              path: p,
              description: `模块化规则文件 (.agents/rules/${file})`,
              content,
              sizeBytes: stats.size,
              lastModified: stats.mtime.toISOString(),
              isEditable: true,
            });
          }
        }
      } catch {}
    }
  }

  // 3. Learned & Implicit Memories
  const implicitDir = join(home, ".gemini", "antigravity", "implicit");
  if (existsSync(implicitDir)) {
    try {
      const files = await readdir(implicitDir);
      for (const file of files.slice(0, 10)) {
        if (file.endsWith(".pb")) {
          const p = join(implicitDir, file);
          const stats = await stat(p);
          learnedMemories.push({
            id: `implicit-${file}`,
            name: `长效会话记忆 (${file.replace(".pb", "").slice(0, 8)})`,
            type: "implicit_knowledge",
            path: p,
            description: "由 Antigravity 自动提炼的跨会话长效记忆与上下文偏好",
            content: `[Protobuf 编码的向量索引与记忆快照：${file}，大小 ${(stats.size / 1024).toFixed(1)} KB]`,
            sizeBytes: stats.size,
            lastModified: stats.mtime.toISOString(),
            isEditable: false,
          });
        }
      }
    } catch {}
  }

  const affinityPath = join(home, ".gemini", "antigravity", "porta_affinity.json");
  if (existsSync(affinityPath)) {
    try {
      const stats = await stat(affinityPath);
      const content = await readFile(affinityPath, "utf-8");
      learnedMemories.push({
        id: "learned-affinity",
        name: "工作区使用亲和度与偏好",
        type: "learned_pattern",
        path: affinityPath,
        description: "记录项目使用偏好、常用模型与快捷习惯的本地亲和度配置",
        content,
        sizeBytes: stats.size,
        lastModified: stats.mtime.toISOString(),
        isEditable: true,
      });
    } catch {}
  }

  return { globalInstructions, workspaceRules, learnedMemories };
}

// ─────────────────────────────────────────────
// 2. Plugins (插件)
// ─────────────────────────────────────────────

export interface PluginItem {
  id: string;
  name: string;
  displayName: string;
  category: "google_official" | "community" | "workspace";
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  isInstalled: boolean;
  path: string;
  bundled: {
    skillsCount: number;
    hooksCount: number;
    mcpCount: number;
    agentsCount: number;
    rulesCount: number;
  };
}

const GOOGLE_OFFICIAL_CATALOG: Record<string, { displayName: string; author: string; description: string }> = {
  "android-cli-plugin": {
    displayName: "Android",
    author: "Android 开发团队",
    description: "Android 核心开发套件，支持 AVD 虚拟机管理、截图审查与 CLI 调试自动化。",
  },
  "modern-web-guidance-plugin": {
    displayName: "Modern Web Guidance",
    author: "Google LLC",
    description: "现代化前端最佳实践指南，让 Agent 紧跟最新的 Web 与无障碍（a11y）开发规范。",
  },
  "google-antigravity-sdk": {
    displayName: "Google Antigravity SDK",
    author: "Google LLC",
    description: "使用 Antigravity Python SDK 构建、测试与部署高智能 AI Agent。",
  },
  "science": {
    displayName: "Science",
    author: "Google LLC",
    description: "面向科学研究与实验数据分析的精选智能体技能包。",
  },
  "firebase": {
    displayName: "Firebase",
    author: "Google LLC",
    description: "Firebase 全栈云服务开发套件，支持后端服务、AI 数据库管理与运维部署。",
  },
  "chrome-devtools-mcp": {
    displayName: "Chrome DevTools",
    author: "Google LLC",
    description: "基于 Puppeteer 与 Chrome DevTools 的深度调试、性能分析与网页自动化审查。",
  },
  "chrome-devtools-plugin": {
    displayName: "Chrome DevTools 插件扩展",
    author: "Chrome DevTools 团队",
    description: "Chrome DevTools 官方全套插件扩展与自动化脚本库。",
  },
  "dart-and-flutter": {
    displayName: "Dart and Flutter",
    author: "Google LLC",
    description: "为 Dart 与 Flutter 跨平台及移动端开发提供量身定制的标准工作流与指导指令。",
  },
  "google-maps-platform": {
    displayName: "Google Maps Platform",
    author: "Google LLC",
    description: "基于 Google Maps 构建位置感知应用：集成交互式地图、地点搜索（Places）与路径计算。",
  },
  "data-agent-kit": {
    displayName: "Data Agent Kit",
    author: "Google LLC",
    description: "针对 Google Cloud 数据库从业者与数据工程师的专用技能套件（BigQuery、Spanner 等）。",
  },
  "gemini-api": {
    displayName: "Gemini API",
    author: "Google LLC",
    description: "基于 Gemini Interactions API 与 Live API 构建应用，支持文本生成、多模态实时音视频与函数调用。",
  },
};

const KNOWN_COMMUNITY_PLUGIN_INFO: Record<string, { displayName: string; description: string }> = {
  "superpowers-zh": {
    displayName: "全套超能力技能库 (Superpowers ZH)",
    description: "包含头脑风暴、TDD测试驱动、系统化调试、隔离工作区等全套高阶开发方法论。",
  },
  "caveman": {
    displayName: "Caveman & Cavecrew (极简模式)",
    description: "极简沟通与 Token 压缩套件，附带专用子智能体（Builder 快速修改、Investigator 调查、Reviewer 审查）。",
  },
  "context7": {
    displayName: "Context7 (技术文档与API检索)",
    description: "实时检索各类现代框架最新官方技术文档与 SDK（支持 React, Vue, Next.js, Prisma, Express 等）。",
  },
  "claude-code-workflows": {
    displayName: "Claude Code Workflows (工作流生态)",
    description: "包含 153 个专用技能的跨平台生态，覆盖架构设计、基础设施、语言开发、安全审计与全栈开发。",
  },
};

async function scanPlugins(): Promise<PluginItem[]> {
  const home = getHomeDir();
  const pluginsDir = join(home, ".gemini", "config", "plugins");
  const plugins: PluginItem[] = [];
  const installedIds = new Set<string>();

  const enabledMap: Record<string, boolean> = {};
  const configJsonPath = getConfigJsonPath();
  if (existsSync(configJsonPath)) {
    try {
      const raw = await readFile(configJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.plugins && typeof parsed.plugins === "object") {
        for (const [k, v] of Object.entries(parsed.plugins)) {
          enabledMap[k] = (v as any)?.enabled !== false;
        }
      }
    } catch {}
  }

  if (existsSync(pluginsDir)) {
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginId = entry.name;
        installedIds.add(pluginId);
        const pluginDir = join(pluginsDir, pluginId);

        let name = pluginId;
        let displayName = pluginId;
        let description = `Antigravity 扩展插件 (${pluginId})`;
        let version = "1.0.0";
        let author = "Community";
        let defaultDisabled = false;
        let category: PluginItem["category"] = "community";

        const isKnownGoogle = !!GOOGLE_OFFICIAL_CATALOG[pluginId];
        const isKnownCommunity = !!KNOWN_COMMUNITY_PLUGIN_INFO[pluginId];

        // Check Google Official Catalog
        if (isKnownGoogle) {
          category = "google_official";
          displayName = GOOGLE_OFFICIAL_CATALOG[pluginId].displayName;
          description = GOOGLE_OFFICIAL_CATALOG[pluginId].description;
          author = GOOGLE_OFFICIAL_CATALOG[pluginId].author;
        } else if (isKnownCommunity) {
          displayName = KNOWN_COMMUNITY_PLUGIN_INFO[pluginId].displayName;
          description = KNOWN_COMMUNITY_PLUGIN_INFO[pluginId].description;
        }

        // 1. Try plugin.json
        const pluginJsonPath = join(pluginDir, "plugin.json");
        if (existsSync(pluginJsonPath)) {
          try {
            const raw = JSON.parse(await readFile(pluginJsonPath, "utf-8"));
            if (raw.name) name = typeof raw.name === "string" ? raw.name : String(raw.name);
            if (raw.description && !isKnownGoogle && !isKnownCommunity) {
              description = typeof raw.description === "string" ? raw.description : String(raw.description);
            }
            if (raw.version) version = typeof raw.version === "string" ? raw.version : String(raw.version);
            if (raw.author && !isKnownGoogle) {
              author = typeof raw.author === "string" ? raw.author : raw.author?.name ? String(raw.author.name) : author;
            }
            if (raw.disabled === true) defaultDisabled = true;
          } catch {}
        }

        // 2. Try gemini-extension.json or package.json
        const extJsonPath = join(pluginDir, "gemini-extension.json");
        if (existsSync(extJsonPath)) {
          try {
            const raw = JSON.parse(await readFile(extJsonPath, "utf-8"));
            if (raw.description && !isKnownGoogle && !isKnownCommunity) {
              description = typeof raw.description === "string" ? raw.description : String(raw.description);
            }
            if (raw.version) version = typeof raw.version === "string" ? raw.version : String(raw.version);
            if (raw.author && !isKnownGoogle) {
              author = typeof raw.author === "string" ? raw.author : raw.author?.name ? String(raw.author.name) : author;
            }
          } catch {}
        }

        const pkgJsonPath = join(pluginDir, "package.json");
        if (existsSync(pkgJsonPath)) {
          try {
            const raw = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
            if (raw.description && !isKnownGoogle && !isKnownCommunity) {
              description = typeof raw.description === "string" ? raw.description : String(raw.description);
            }
            if (raw.version) version = typeof raw.version === "string" ? raw.version : String(raw.version);
            if (raw.author && !isKnownGoogle) {
              author = typeof raw.author === "string" ? raw.author : raw.author?.name ? String(raw.author.name) : author;
            }
          } catch {}
        }

        let skillsCount = 0;
        let hooksCount = 0;
        let mcpCount = 0;
        let agentsCount = 0;
        let rulesCount = 0;

        const skillsSubDir = join(pluginDir, "skills");
        if (existsSync(skillsSubDir)) {
          try {
            const s = await readdir(skillsSubDir);
            skillsCount = s.filter((item) => !item.startsWith(".")).length;
          } catch {}
        }

        const hooksJsonPath = join(pluginDir, "hooks.json");
        if (existsSync(hooksJsonPath)) {
          try {
            const raw = JSON.parse(await readFile(hooksJsonPath, "utf-8"));
            hooksCount = Object.keys(raw).length;
          } catch {}
        }

        const mcpJsonPath = join(pluginDir, "mcp_config.json");
        if (existsSync(mcpJsonPath)) {
          try {
            const raw = JSON.parse(await readFile(mcpJsonPath, "utf-8"));
            mcpCount = Object.keys(raw.mcpServers ?? raw).length;
          } catch {}
        }

        const agentsSubDir = join(pluginDir, "agents");
        if (existsSync(agentsSubDir)) {
          try {
            const a = await readdir(agentsSubDir);
            agentsCount = a.filter((f) => f.endsWith(".md")).length;
          } catch {}
        }

        const rulesSubDir = join(pluginDir, "rules");
        if (existsSync(rulesSubDir)) {
          try {
            const r = await readdir(rulesSubDir);
            rulesCount = r.filter((f) => f.endsWith(".md")).length;
          } catch {}
        }

        const isEnabled = enabledMap[pluginId] !== undefined ? enabledMap[pluginId] : !defaultDisabled;

        plugins.push({
          id: pluginId,
          name,
          displayName,
          category,
          description,
          version,
          author,
          enabled: isEnabled,
          isInstalled: true,
          path: pluginDir,
          bundled: {
            skillsCount,
            hooksCount,
            mcpCount,
            agentsCount,
            rulesCount,
          },
        });
      }
    } catch {}
  }

  // 3. Add uninstalled Google Official Catalog items (e.g. Science)
  for (const [catId, info] of Object.entries(GOOGLE_OFFICIAL_CATALOG)) {
    if (!installedIds.has(catId)) {
      plugins.push({
        id: catId,
        name: catId,
        displayName: info.displayName,
        category: "google_official",
        description: info.description,
        version: "1.0.0",
        author: info.author,
        enabled: false,
        isInstalled: false,
        path: join(pluginsDir, catId),
        bundled: {
          skillsCount: 0,
          hooksCount: 0,
          mcpCount: 0,
          agentsCount: 0,
          rulesCount: 0,
        },
      });
    }
  }

  return plugins;
}

// ─────────────────────────────────────────────
// 3. Skills (技能)
// ─────────────────────────────────────────────

export interface SkillDetail {
  name: string;
  title: string;
  description: string;
  source: "builtin" | "global" | "plugin" | "workspace";
  pluginName?: string;
  path: string;
  hasScripts: boolean;
  hasReferences: boolean;
}

const FRIENDLY_SKILL_TITLES: Record<string, string> = {
  brainstorming: "头脑风暴 (Brainstorming)",
  "dispatching-parallel-agents": "并行智能体调度 (Parallel Agents)",
  "executing-plans": "执行实施计划 (Executing Plans)",
  "finishing-a-development-branch": "分支收尾合并 (Finishing Branch)",
  frontend_design: "前端极致设计 (Frontend Design)",
  "receiving-code-review": "代码评审接收 (Receiving Review)",
  "requesting-code-review": "代码评审请求 (Requesting Review)",
  "subagent-driven-development": "子代理驱动开发 (Subagent Driven Dev)",
  superpowers: "超级超能力核心 (Superpowers)",
  "systematic-debugging": "系统化调试排障 (Systematic Debugging)",
  "test-driven-development": "测试驱动开发 (TDD)",
  "ui-ux-pro-max": "UI/UX 极致设计 (UI/UX Pro Max)",
  "using-git-worktrees": "Git 隔离工作区 (Worktrees)",
  "using-superpowers": "超能力规范调度 (Using Superpowers)",
  "verification-before-completion": "完工实证验证 (Verification)",
  "writing-plans": "编写实施计划 (Writing Plans)",
  "writing-skills": "编写专属技能 (Writing Skills)",
  "chinese-code-review": "中文代码评审规范",
  "chinese-commit-conventions": "中文 Commit 提交规范",
  "chinese-documentation": "中文技术文档排版指南",
  "chinese-git-workflow": "国内 Git 平台接入 (Gitee/GitLab)",
  "mcp-builder": "MCP 服务器构建方法论",
  "workflow-runner": "工作流执行引擎 (Workflow Runner)",
  "a11y-debugging": "无障碍可访问性审计 (A11y)",
  "chrome-devtools": "Chrome DevTools 自动化调试",
  "chrome-devtools-cli": "Chrome DevTools 命令行自动化",
  "debug-optimize-lcp": "LCP 网页加载性能优化",
  "memory-leak-debugging": "内存泄漏深度排障 (Memory Leaks)",
  troubleshooting: "DevTools 连接与排障指南",
  cavecrew: "Cavecrew 子智能体调度指南",
  caveman: "Caveman 极简模式切换",
  "caveman-commit": "Caveman 极简 Commit 消息",
  "caveman-compress": "记忆文件 Token 压缩器",
  "caveman-help": "Caveman 指令速查卡片",
  "caveman-init": "Caveman 项目一键初始化",
  "caveman-review": "单行极简代码评审",
  "caveman-stats": "Token 消耗与节省统计",
  "android-cli": "Android CLI 开发调试工具",
  "context7-cli": "Context7 命令行工具",
  "context7-mcp": "Context7 实时技术文档服务",
  "find-docs": "最新技术文档与 API 检索 (Find Docs)",
  "agy-customizations": "Antigravity 自定义扩展指南",
  antigravity_guide: "Antigravity 2.0+ 全功能使用指南",
  "scientific-research": "科学研究与数据分析 (Science)",
  "flutter-development": "Flutter & Dart 移动开发工作流",
  "google-maps-api": "Google Maps 交互地图与位置 API",
  "cloud-data-engineering": "Google Cloud 数据工程套件",
  "gemini-api-patterns": "Gemini API 多模态开发范式",
};

const FRIENDLY_SKILL_DESCS: Record<string, string> = {
  brainstorming: "在进行任何功能开发或架构设计前，深入探索用户意图、梳理需求并推导多维度设计方案。",
  "dispatching-parallel-agents": "当面临 2 个以上可独立运行的任务时，并行调度子智能体以极大提升交付效率。",
  "executing-plans": "严格按照书面实施计划逐步推进，设立审查检查点并在独立会话中执行。",
  "finishing-a-development-branch": "开发完成且全部测试通过后，提供结构化的代码合并、PR 创建或工作区分支清理方案。",
  frontend_design: "构建兼具高端视觉质感与生产级别的独特前端 UI 界面，避免平庸的默认排版与风格。",
  "receiving-code-review": "严谨校验并分析代码评审反馈，杜绝盲目附和，推导严密的技术修改方案。",
  "requesting-code-review": "在完成重大功能或合并代码前，严格验证交付质量是否完全符合产品规格书。",
  "subagent-driven-development": "在当前会话中为各个独立子任务驱动子智能体协作完成，保持上下文整洁与专注。",
  superpowers: "理清复杂开发思路、拆解重大开发任务，应用系统级的头脑风暴与高阶架构评估。",
  "systematic-debugging": "遇到 Bug 或测试失败时，在动手修改代码前系统化分析复现、推导根因与防御策略。",
  "test-driven-development": "在编写功能实现代码之前，先编写严格的测试用例与断言逻辑，确保代码可靠性。",
  "ui-ux-pro-max": "内置涵盖 50+ 风格、161+ 色板、57+ 字体搭配与 99+ 条核心设计指南的专业智囊库。",
  "using-git-worktrees": "利用原生 Git Worktree 创建与当前工作区完全隔离的干净目录，确保并行开发互不干扰。",
  "using-superpowers": "规范智能体在响应与澄清前必须主动加载和检索最匹配技能的系统化工作流。",
  "verification-before-completion": "在声称任务完成前强制运行验证命令并检查输出证据，杜绝任何未验证的盲目断言。",
  "writing-plans": "面对多步骤复合复杂需求，在动手编码前输出条理清晰、具备验收标准的计划文档。",
  "writing-skills": "指导创建、规范编写、编辑与部署新的智能体专属技能定义文件（SKILL.md）。",
  "chinese-code-review": "中文 Review 沟通话术模板、分级标注（必须修复/建议修改/仅供参考）与国内反模式应对。",
  "chinese-commit-conventions": "Conventional Commits 中文适配与 commitlint/husky 中文提交模版。",
  "chinese-documentation": "中文文档排版参考：中英文空格、全半角标点、专业术语保留与文案排版指北规范。",
  "chinese-git-workflow": "Gitee、Coding.net、极狐 GitLab、CNB 等国内代码托管平台的 SSH/HTTPS 接入与镜像同步。",
  "mcp-builder": "系统化构建生产级 Model Context Protocol (MCP) 服务器，让 AI 助手连接外部能力。",
  "workflow-runner": "直接运行 agency-orchestrator YAML 工作流，调度多角色智能体协同完成大型任务。",
  "a11y-debugging": "基于 web.dev 指南进行无障碍审计：检查语义 HTML、ARIA 标签、焦点状态、键盘导航与色彩对比度。",
  "chrome-devtools": "通过 DevTools 协议实现网页自动化交互、控制台错误抓取、DOM 结构检查与网络请求分析。",
  "chrome-devtools-cli": "使用命令行脚本驱动浏览器自动化操作与快速批量网页测试。",
  "debug-optimize-lcp": "诊断并优化最大内容绘制（LCP）与 Core Web Vitals 核心指标，大幅提升首屏加载速度。",
  "memory-leak-debugging": "诊断 Node.js / JavaScript 应用程序中的内存泄漏，分析堆内存快照与 OOM 根因。",
  troubleshooting: "排查 Chrome DevTools MCP 连接失败、页面目标丢失与服务初始化异常。",
  cavecrew: "精准调度 Builder（精准修改）、Investigator（代码排查）或 Reviewer（审查），压缩 60% 冗余上下文。",
  caveman: "切换精简沟通强度（lite / full / ultra / wenyan 文言），极大节省 Token 损耗。",
  "caveman-commit": "生成极其精简有力的极简风格 Git Commit 提交消息。",
  "caveman-compress": "压缩自然语言记忆与规则文件（CLAUDE.md / GEMINI.md），无损保留核心逻辑并大幅降低输入 Token。",
  "caveman-help": "单次呈现 Caveman 所有精简模式、技能与指令的快速参考指南。",
  "caveman-init": "为当前项目一键配置常驻极简激活规则，自动生效于所有 IDE 智能体。",
  "caveman-review": "输出单行极简 Code Review 反馈意见，直击关键代码瑕疵。",
  "caveman-stats": "查看当前会话的真实 Token 使用量及 Caveman 为您节省的预估 Token 数据。",
  "android-cli": "Android 命令行工具：创建 Android 项目、管理 AVD 虚拟机、屏幕截图、UI 审查与 SDK 管理。",
  "context7-cli": "使用 ctx7 CLI 快速抓取各大技术库最新官方文档、管理 AI 技能与配置 MCP。",
  "context7-mcp": "当涉及 React、Vue、Next.js、Prisma 等现代技术栈时，实时提供最新 API 参考与代码示例。",
  "find-docs": "实时抓取任意框架或 SDK 的最新官方技术文档与 API 规范，彻底杜绝训练数据过时导致的 AI 幻觉。",
  "agy-customizations": "Antigravity 技能、规则、插件、钩子与 MCP 架构设计规范与优先级配置完整手册。",
  antigravity_guide: "Antigravity IDE 2.0+、agy CLI、Python SDK、斜杠指令与环境配置的权威全景手册。",
  "scientific-research": "面向科学研究、数据建模与实验数据深度分析的精选技能。",
  "flutter-development": "Dart 与 Flutter 跨平台及移动端开发量身定制的标准工作流与指导指令。",
  "google-maps-api": "基于 Google Maps 构建位置感知应用：集成交互式地图、地点搜索（Places）与路径计算。",
  "cloud-data-engineering": "针对 Google Cloud 数据库从业者与数据工程师的专用技能套件（BigQuery、Spanner 等）。",
  "gemini-api-patterns": "基于 Gemini Interactions API 与 Live API 构建应用，支持文本生成、多模态实时音视频与函数调用。",
};

async function scanSkillsDir(
  dir: string,
  source: "builtin" | "global" | "plugin" | "workspace",
  pluginName?: string,
): Promise<SkillDetail[]> {
  const result: SkillDetail[] = [];
  if (!existsSync(dir)) return result;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillName = entry.name;
      const skillDir = join(dir, skillName);
      const skillMdPath = join(skillDir, "SKILL.md");

      // Normalize key to find matched Chinese description
      const normalizedKey = skillName
        .toLowerCase()
        .replace(/[\u4e00-\u9fa5]/g, "")
        .replace(/[-_]+$/, "")
        .trim();

      let desc = FRIENDLY_SKILL_DESCS[skillName] ?? FRIENDLY_SKILL_DESCS[normalizedKey] ?? "";
      let title = FRIENDLY_SKILL_TITLES[skillName] ?? FRIENDLY_SKILL_TITLES[normalizedKey] ?? "";

      if (!title) {
        title = skillName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }

      if (existsSync(skillMdPath)) {
        try {
          const content = await readFile(skillMdPath, "utf-8");
          const { data } = parseYamlFrontmatter(content);
          if (data.description && !desc) {
            desc = data.description;
          }
          if (data.name && !FRIENDLY_SKILL_TITLES[skillName] && !FRIENDLY_SKILL_TITLES[normalizedKey]) {
            title = data.name;
          }
        } catch {}
      }

      const hasScripts = existsSync(join(skillDir, "scripts"));
      const hasReferences = existsSync(join(skillDir, "references")) || existsSync(join(skillDir, "docs"));

      result.push({
        name: skillName,
        title,
        description: desc || `Antigravity ${source === "builtin" ? "内置" : "扩展"}技能`,
        source,
        pluginName,
        path: skillDir,
        hasScripts,
        hasReferences,
      });
    }
  } catch {}

  return result;
}

// ─────────────────────────────────────────────
// 4. Subagents (子智能体)
// ─────────────────────────────────────────────

export interface SubagentDetail {
  id: string;
  name: string;
  role: string;
  description: string;
  tools: string[];
  systemPrompt: string;
  source: "builtin" | "plugin" | "workspace" | "custom";
  pluginName?: string;
  path?: string;
}

const BUILTIN_SUBAGENTS: SubagentDetail[] = [
  {
    id: "self",
    name: "self (自身镜像智能体)",
    role: "主智能体完整镜像",
    description: "继承父级智能体的全部配置、工具、提示词与模型，用于在独立会话上下文中运行隔离子任务。",
    tools: ["所有当前主工具", "read_file", "write_to_file", "run_command", "grep_search", "mcp_tools"],
    systemPrompt: "Subagent that inherits the parent agent's full configuration including tools, system prompt, and model.",
    source: "builtin",
  },
  {
    id: "research",
    name: "research (代码库与网络调研员)",
    role: "只读代码与在线文档研究员",
    description: "配备只读探索工具，用于通读大型代码库、检索网络资料或查阅文档，避免主会话上下文污染。",
    tools: ["view_file", "grep_search", "find_by_name", "list_dir", "search_web", "read_url_content"],
    systemPrompt: "Research subagent with read-only tools for exploring the codebase, searching the web, and reading files.",
    source: "builtin",
  },
];

const KNOWN_SUBAGENTS_LOCALIZATION: Record<string, { role: string; description: string }> = {
  "cavecrew-builder": {
    role: "极简代码构建员 (Builder)",
    description: "手术刀式 1-2 个文件的精准修改。负责修复拼写错误、单函数重构、机械性重命名、冗余清理与格式微调。严格拒绝 3+ 文件的过度扩散，返回极简 diff 回执。",
  },
  "cavecrew-investigator": {
    role: "只读代码定位员 (Investigator)",
    description: "只读代码排查与定位器。返回精准的文件:行号定位表（如“X 在哪定义”、“Y 被谁调用”），相比常规全量探索节约约 60% 上下文 Token。",
  },
  "cavecrew-reviewer": {
    role: "极简代码评审员 (Reviewer)",
    description: "Diff 与分支文件审查器。按严重程度逐条输出单行评审意见，直击代码缺陷，绝无冗余废话与范围蔓延。",
  },
};

async function scanSubagents(): Promise<SubagentDetail[]> {
  const list: SubagentDetail[] = [...BUILTIN_SUBAGENTS];
  const home = getHomeDir();
  const pluginsDir = join(home, ".gemini", "config", "plugins");
  const globalAgentsDir = join(home, ".gemini", "config", "agents");

  // 1. Scan plugin agents
  if (existsSync(pluginsDir)) {
    try {
      const plugins = await readdir(pluginsDir, { withFileTypes: true });
      for (const p of plugins) {
        if (!p.isDirectory()) continue;
        const agentsDir = join(pluginsDir, p.name, "agents");
        if (existsSync(agentsDir)) {
          const files = await readdir(agentsDir);
          for (const f of files) {
            if (f.endsWith(".md")) {
              const filePath = join(agentsDir, f);
              try {
                const content = await readFile(filePath, "utf-8");
                const { data, body } = parseYamlFrontmatter(content);
                const name = data.name || f.replace(".md", "");
                const localInfo = KNOWN_SUBAGENTS_LOCALIZATION[name];

                list.push({
                  id: `plugin-${p.name}-${name}`,
                  name,
                  role: localInfo?.role ?? `${p.name} 专用子智能体`,
                  description: localInfo?.description ?? data.description ?? `${p.name} 提供的智能体`,
                  tools: Array.isArray(data.tools) ? data.tools : ["Read", "Edit", "Write", "Grep", "Glob"],
                  systemPrompt: body,
                  source: "plugin",
                  pluginName: p.name,
                  path: filePath,
                });
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  // 2. Scan global custom agents (~/.gemini/config/agents/*.md)
  if (existsSync(globalAgentsDir)) {
    try {
      const files = await readdir(globalAgentsDir);
      for (const f of files) {
        if (f.endsWith(".md")) {
          const filePath = join(globalAgentsDir, f);
          try {
            const content = await readFile(filePath, "utf-8");
            const { data, body } = parseYamlFrontmatter(content);
            const name = data.name || f.replace(".md", "");
            list.push({
              id: `custom-${name}`,
              name,
              role: "用户全局自定义智能体",
              description: data.description || "存放于 ~/.gemini/config/agents/ 的自定义智能体",
              tools: Array.isArray(data.tools) ? data.tools : ["所有当前工具"],
              systemPrompt: body,
              source: "custom",
              path: filePath,
            });
          } catch {}
        }
      }
    } catch {}
  }

  return list;
}

// ─────────────────────────────────────────────
// 5. MCP Servers (MCP 服务器)
// ─────────────────────────────────────────────

export interface McpServerDetailed {
  name: string;
  description: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  serverUrl?: string;
  envKeys?: string[];
  disabled: boolean;
  toolsCount: number;
  tools: Array<{ name: string; description: string }>;
  source: "config" | "plugin" | "workspace";
  path?: string;
}

const FRIENDLY_MCP_DESCS: Record<string, string> = {
  "blender-mcp": "Blender 3D 资产建模、渲染调度、Polyhaven 与 Sketchfab 模型检索集成。",
  "chrome-devtools-mcp": "Chrome DevTools 原生自动化网页交互、DOM 检查与 Console 审查。",
  "eagle-mcp": "Eagle 设计资源库与素材管理集成。",
  "github-mcp-server": "GitHub 仓库检索、分支建立、PR 自动创建与代码合并自动化。",
  "prisma-mcp-server": "Prisma 数据库迁移状态监控与 Prisma Studio 调试可视化。",
  "sequential-thinking": "Sequential Thinking 顺序思考与复杂逻辑推理引擎。",
  StitchMCP: "Stitch UI 设计稿自动缝合与代码转换引擎。",
  "videostudio-tutorial": "自动化视频教程录制、片段合成与渲染流水线。",
  "anty-mcp": "Anty 移动端环境辅助自动化调度服务。",
  context7: "Context7 实时技术文档与最新 API 检索服务。",
};

const FRIENDLY_MCP_TOOL_DESCS: Record<string, string> = {
  // ── StitchMCP ──
  apply_design_system: "将指定设计系统规范（配色、字体、圆角与排版 Token）应用到选定的 UI 界面屏幕。",
  create_design_system: "为项目创建新的全局设计系统规范（配置主题调色板、字体库、组件圆角与深浅色模式）。",
  create_design_system_from_design_md: "基于用户上传的 DESIGN.md 设计规范文档，自动解析并创建全局 UI 设计系统。",
  create_project: "新建 Stitch UI 项目工程，作为多页面 UI 设计稿与前端代码的顶层容器。",
  delete_project: "根据项目名称永久删除指定的 Stitch UI 项目及所有关联界面。",
  edit_screens: "根据自然语言指令或修改需求，对项目内的现有页面屏幕进行局部或全局改版更新。",
  generate_screen_from_text: "通过自然语言文本提示词，直接生成全新的高保真前端 UI 界面与交互布局。",
  generate_variants: "为指定页面屏幕生成多种不同布局风格、配色与组件变体方案供对比选择。",
  get_project: "获取指定 Stitch 项目的详细元数据、页面列表与设计规范关联信息。",
  get_screen: "获取特定页面屏幕的详细 UI 结构、组件层级与样式定义代码。",
  list_design_systems: "列出当前账号或项目中所有可用的 UI 设计系统规范列表。",
  list_projects: "列出所有 Stitch 项目工程列表及基本概况。",
  list_screens: "列出指定 Stitch 项目内的所有页面屏幕索引与缩略信息。",
  update_design_system: "更新现有设计系统的配色方案、字体、间距或组件样式 Token。",
  upload_design_md: "上传 DESIGN.md 设计规范 Markdown 文档至指定 Stitch 项目中。",

  // ── blender-mcp ──
  get_scene_info: "获取当前 Blender 场景全景信息（网格、相机、灯光、材质与层级结构）。",
  get_object_info: "获取指定 3D 对象的几何数据、坐标变换矩阵与材质属性。",
  get_viewport_screenshot: "截取当前 Blender 3D 视口的实时渲染预览截图。",
  execute_blender_code: "在当前 Blender 实例中执行原生 Python 自动化脚本与建模逻辑。",
  get_polyhaven_categories: "获取 Polyhaven 免费开源 3D 资产（模型、材质、HDR 贴图）的分类列表。",
  search_polyhaven_assets: "在 Polyhaven 资产库中搜索模型、PBR 材质贴图或 HDR 全景环境光。",
  download_polyhaven_asset: "下载并一键导入 Polyhaven 3D 资产到当前 Blender 场景中。",
  set_texture: "为指定 3D 模型的材质槽位赋予或更换纹理贴图。",
  get_polyhaven_status: "检查 Polyhaven 资产检索与下载服务的在线运行状态。",
  get_hyper3d_status: "检查 Hyper3D (Rodin) AI 3D 建模服务的 API 连接状态。",
  get_sketchfab_status: "检查 Sketchfab 3D 模型市场的 API 连接与认证状态。",
  search_sketchfab_models: "在 Sketchfab 模型库中搜索可下载的 3D 模型资产。",
  get_sketchfab_model_preview: "获取 Sketchfab 3D 模型的详情、预览图与面数元数据。",
  download_sketchfab_model: "下载指定的 Sketchfab 3D 模型并自动导入到 Blender 工作区。",
  generate_hyper3d_model_via_text: "通过自然语言文本提示词调用 Hyper3D (Rodin) AI 生成 3D 几何网格模型。",
  generate_hyper3d_model_via_images: "通过单张或多张参考图片生成高质量 3D 模型资产。",
  poll_rodin_job_status: "轮询查询 Rodin AI 3D 建模后台任务的生成进度与状态。",
  import_generated_asset: "将 AI 生成完成的 3D 资产下载并导入当前 Blender 场景。",
  get_hunyuan3d_status: "检查腾讯混元 3D (Hunyuan3D) AI 建模服务的在线状态。",
  generate_hunyuan3d_model: "调用腾讯混元 3D 模型生成接口（支持文生 3D / 图生 3D）。",
  poll_hunyuan_job_status: "轮询查询混元 3D 任务的生成进度与下载链接。",
  import_generated_asset_hunyuan: "将混元 3D 生成的模型资产导入当前 Blender 场景。",

  // ── chrome-devtools / chrome-devtools-mcp ──
  click: "模拟鼠标点击指定的页面 DOM 元素或指定坐标点。",
  close_page: "关闭当前或指定的浏览器标签页。",
  drag: "在页面上模拟鼠标拖拽操作（拖动元素至目标位置）。",
  emulate: "模拟移动端视口分辨率、User Agent、触摸事件及网络限速环境。",
  evaluate_script: "在当前页面 JavaScript 上下文中执行任意 JS 脚本并返回计算结果。",
  fill: "快速填充指定的表单输入框文本内容。",
  fill_form: "批量填充复杂表单中的多个输入框、下拉框或单选复选组件。",
  get_console_message: "获取当前浏览器页面的 Console 控制台实时输出日志。",
  get_network_request: "获取特定网络请求的详细报文（请求头、响应头、Payload 及返回体）。",
  handle_dialog: "自动响应页面的原生对话框（Alert、Confirm、Prompt 确认或取消）。",
  hover: "模拟鼠标悬停在指定 DOM 元素上方以触发 Hover 动效。",
  lighthouse_audit: "运行 Google Lighthouse 进行全面的网页性能、SEO、PWA 与无障碍审计。",
  list_console_messages: "列出页面控制台捕获的所有错误（Error）、警告（Warn）与日志（Log）。",
  list_network_requests: "列出页面加载过程中的所有网络请求瀑布流及状态码。",
  list_pages: "列出当前 Chrome 实例中打开的所有标签页与活动页面。",
  navigate_page: "在浏览器中导航跳转至指定的 URL 网址并等待页面加载完成。",
  new_page: "在 Chrome 浏览器中新建一个空白标签页或打开指定 URL。",
  performance_analyze_insight: "深入分析 Chrome 录制的 Performance 性能分析日志与卡顿瓶颈。",
  performance_start_trace: "启动 Chrome 底层性能追踪与帧率渲染录制。",
  performance_stop_trace: "停止性能追踪并导出完整的性能分析报告数据。",
  press_key: "模拟键盘按键输入（支持组合快捷键如 Enter, Tab, Ctrl+A 等）。",
  resize_page: "调整当前浏览器视口的宽度和高度尺寸。",
  select_page: "切换当前活动的浏览器标签页焦点。",
  take_heapsnapshot: "抓取当前 V8 引擎的堆内存快照（Heap Snapshot）用于排查内存泄漏。",
  take_screenshot: "截取当前视口或整页网页截图（支持 PNG/JPEG 格式）。",
  take_snapshot: "导出当前页面完整的 DOM 结构快照与无障碍可访问性树（A11y Tree）。",
  type_text: "模拟人类逐字键盘打字输入文本。",
  upload_file: "向页面的 <input type='file'> 上传指定本地文件。",
  wait_for: "等待指定 DOM 元素出现、特定网络请求完成或满足延时条件。",

  // ── github-mcp-server ──
  search_repositories: "在 GitHub 上搜索匹配的开源项目仓库。",
  search_code: "在 GitHub 仓库代码库中搜索指定代码片段或符号。",
  search_issues: "在指定仓库中搜索 Issue 或 Pull Request。",
  search_users: "在 GitHub 全网搜索用户与开发者组织。",
  get_file_contents: "获取 GitHub 仓库指定分支或 Tag 下的文件内容与元数据。",
  create_or_update_file: "在 GitHub 仓库中创建新文件或提交文件内容更新（Commit）。",
  push_files: "原子性批量提交并推送多个修改文件到指定分支。",
  create_branch: "在 GitHub 仓库中基于指定基线创建新的 Git 分支。",
  list_commits: "获取指定仓库和分支的 Git Commit 提交历史记录。",
  list_issues: "列出仓库中的 Issue 列表（支持状态、标签与作者筛选）。",
  get_issue: "获取单个 Issue 的详细描述、状态与元数据。",
  create_issue: "在 GitHub 仓库中创建新的 Issue 议题。",
  update_issue: "更新 Issue 的标题、状态（Open/Closed）、分配人或标签。",
  add_issue_comment: "在指定的 Issue 或 PR 下发表评论回复。",
  list_pull_requests: "列出仓库中的 Pull Request (PR) 列表。",
  get_pull_request: "获取指定 Pull Request 的详细状态与 Merge 冲突信息。",
  get_pull_request_files: "获取 Pull Request 包含的所有修改文件与 Diff 变更差异。",
  get_pull_request_comments: "获取 Pull Request 中的所有评论与 Review 留言记录。",
  get_pull_request_reviews: "获取 Pull Request 的代码评审记录与 Approve/Request Changes 状态。",
  get_pull_request_status: "获取 PR 关联的 CI/CD 自动化流水线构建与检查状态。",
  create_pull_request: "基于开发分支向目标分支发起新的 Pull Request。",
  create_pull_request_review: "提交对 PR 的代码审查意见（Approve 批准、Request Changes 要求修改或 Comment 评论）。",
  merge_pull_request: "将通过审查的 Pull Request 合并（Merge / Squash / Rebase）到目标主分支。",
  update_pull_request_branch: "将目标基线分支的最新代码同步合并到当前 PR 分支。",
  create_repository: "在当前 GitHub 账号或组织下创建全新的 Git 仓库。",
  fork_repository: "将目标 GitHub 仓库 Fork 复刻到个人账号下。",

  // ── context7 & prisma & sequential-thinking & others ──
  "query-docs": "在 Context7 文档库中深度检索指定技术库或框架的最新官方 API 示例与手册。",
  "resolve-library-id": "将技术库名称解析为 Context7 标准 Library ID（如把 'nextjs' 映射为 'next-js'）。",
  "Prisma-Studio": "启动并管理本地 Prisma Studio 可视化数据浏览器与管理面板。",
  "migrate-dev": "执行 prisma migrate dev 迁移，更新本地数据库 Schema 并生成 Prisma Client。",
  "migrate-status": "检查当前数据库迁移状态，对比 Schema 与数据库实际表结构的差异。",
  sequentialthinking: "逐步拆解复杂难题，运用逻辑树推导、假设验证与自我修正进行深度顺序推理。",
  ai_search_by_text: "在 Eagle 素材库中运用 AI 自然语言语义检索图像与设计资产。",
  ai_search_by_item: "在 Eagle 中以图搜图，检索视觉风格与配色相似的素材。",
  folder_create: "在 Eagle 素材库中创建新的分类文件夹。",
  folder_get: "获取 Eagle 文件夹的层级结构与包含素材概况。",
  folder_update: "重命名或更新 Eagle 文件夹属性。",
  item_add: "向 Eagle 设计素材库中添加新的图片或多媒体素材。",
  item_get: "获取指定 Eagle 素材的详细元数据与本地预览文件。",
  item_update: "更新 Eagle 素材的名称、标签、评分或描述备注。",
  item_move_to_trash: "将 Eagle 素材移入废纸篓或回收站。",
  tag_group_create: "在 Eagle 中创建新的设计标签分组。",
  tag_merge: "合并 Eagle 素材库中相似或重复的标签。",
  tag_update: "重命名或调整 Eagle 标签信息。",
  // ── videostudio-tutorial ──
  video_tutorial_auto: "一键全自动录制与合成视频教程：从 Markdown 教程文档自动执行屏幕录制、动作模拟与旁白解说合成。",
  video_tutorial_prepare: "视频录制前置准备与环境校验：检查 LLM API Key、浏览器驱动与录屏录音设备状态。",
  video_tutorial_render: "分步渲染合成视频教程：将 AI 生成的分镜脚本、屏幕录像与配音音频渲染为最终的 MP4 视频教程文件。",

  // ── anty-mcp ──
  anty_accounts_status: "查看 Antigravity 账号池全量状态：列出所有账号、额度过期时间、是否失效及当前活跃账号。",
  anty_check_job: "检查异步分发任务状态：查询通过 async 异步模式提交的 Antigravity 任务执行进度与产出结果。",
  anty_continue: "按会话 ID 继续前置 Antigravity 会话：遇到配额不足错误时自动无缝轮换可用账号。",
  anty_dispatch: "分发任务至 Antigravity (agy CLI) 核心执行：支持代码编写、文件操作、单元测试与全流程开发任务。",
  anty_get_live_progress: "实时查看 Antigravity 运行状态：即时捕获当前思考流、正在调用的工具动作与耗时。",
  anty_get_transcript: "获取执行历史轨迹：导出指定会话 ID 的完整 JSONL 操作日志与会话轨迹。",
  anty_list_agents: "列出 Antigravity 中所有可用的子智能体类型及配置。",
  anty_list_models: "列出 Antigravity 当前支持的所有底层大语言模型列表。",
  anty_list_plugins: "列出当前系统中已安装的所有 Antigravity 官方及社区插件。",
  anty_status: "探测 Antigravity 引擎连通性并检查账号池容量与活跃连接。",
  anty_switch_account: "主动切换 Antigravity 活跃账号或手动触发账号池轮询轮换。",

  // ── cockpit-antigravity-switcher ──
  decrypt_antigravity_token: "解密并校验 Antigravity 本地存储的会话凭证 Token。",
  get_antigravity_quota: "获取当前 Antigravity 账号的实时配额余量与重置倒计时。",
  get_current_antigravity_account: "获取当前正在使用的 Antigravity 账号邮箱与认证信息。",
  list_antigravity_accounts: "列出所有已绑定的 Antigravity 多账号池列表。",
  switch_antigravity_account: "切换至指定的 Antigravity 账号身份。",
};

async function scanMcpServers(): Promise<McpServerDetailed[]> {
  const home = getHomeDir();
  const mcpConfigPath = getMcpConfigPath();
  const mcpDir = join(home, ".gemini", "antigravity", "mcp");
  const list: McpServerDetailed[] = [];

  let configServers: Record<string, any> = {};
  if (existsSync(mcpConfigPath)) {
    try {
      const raw = JSON.parse(await readFile(mcpConfigPath, "utf-8"));
      configServers = raw.mcpServers || raw;
    } catch {}
  }

  for (const [serverName, conf] of Object.entries(configServers)) {
    const desc = FRIENDLY_MCP_DESCS[serverName] ?? `${serverName} MCP 服务`;
    const disabled = conf.disabled === true;
    const transport: "stdio" | "sse" = conf.serverUrl ? "sse" : "stdio";

    const envKeys = conf.env ? Object.keys(conf.env) : [];

    const serverSchemaDir = join(mcpDir, serverName);
    const tools: Array<{ name: string; description: string }> = [];

    if (existsSync(serverSchemaDir)) {
      try {
        const files = await readdir(serverSchemaDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            const toolName = file.replace(/\.json$/, "");
            let toolDesc = FRIENDLY_MCP_TOOL_DESCS[toolName] ?? "";
            if (!toolDesc) {
              try {
                const toolContent = JSON.parse(await readFile(join(serverSchemaDir, file), "utf-8"));
                if (toolContent.description) toolDesc = toolContent.description;
              } catch {}
            }
            if (!toolDesc) {
              toolDesc = `${serverName} 工具 (${toolName})`;
            }
            tools.push({ name: toolName, description: toolDesc });
          }
        }
      } catch {}
    }

    // Determine the local file/directory path to open for this MCP
    let serverPath: string | undefined = undefined;
    if (conf.command && typeof conf.command === "string") {
      const cleanCmd = conf.command.replace(/^["']|["']$/g, "");
      if (existsSync(cleanCmd)) {
        serverPath = cleanCmd;
      }
    }
    if (!serverPath && conf.args && Array.isArray(conf.args)) {
      for (const arg of conf.args) {
        if (typeof arg === "string") {
          const cleanArg = arg.replace(/^["']|["']$/g, "");
          if (existsSync(cleanArg)) {
            serverPath = cleanArg;
            break;
          }
        }
      }
    }
    if (!serverPath && existsSync(serverSchemaDir)) {
      serverPath = serverSchemaDir;
    }
    if (!serverPath && existsSync(mcpConfigPath)) {
      serverPath = mcpConfigPath;
    }

    list.push({
      name: serverName,
      description: desc,
      transport,
      command: conf.command,
      args: conf.args,
      serverUrl: conf.serverUrl,
      envKeys,
      disabled,
      toolsCount: tools.length,
      tools,
      source: "config",
      path: serverPath,
    });
  }

  return list;
}

// ─────────────────────────────────────────────
// 6. Commands (命令)
// ─────────────────────────────────────────────

export interface CommandItem {
  cmd: string;
  name: string;
  description: string;
  category: "slash_builtin" | "plugin_command" | "workspace_command" | "custom_command";
  usage?: string;
  argumentHint?: string;
  pluginName?: string;
  promptSnippet?: string;
  fullPrompt?: string;
  path?: string;
  dirPath?: string;
  source?: "builtin" | "plugin" | "custom" | "workspace";
  enabled?: boolean;
}

const BUILTIN_SLASH_COMMANDS: CommandItem[] = [
  {
    cmd: "/goal",
    name: "目标自治推进模式 (Autonomous Goal)",
    description: "通宵超长任务自治推进，达成指定的宏大开发目标前绝不终止。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/goal <要达成的目标描述>",
    fullPrompt: `### 🎯 指令定位与核心机制
\`/goal\` 是 Antigravity 的**目标自治推进模式 (Autonomous Goal Execution Loop)**。
当开启此模式时，智能体将转入长效自治推进状态，不再频繁因微小琐碎决策暂停等待用户交互，而是根据指定的宏大目标自主进行全流程规划、编码、测试验证与错误自愈。

### ⚙️ 运行时行为规范 (Runtime Behavioral Specs)
1. **宏观规划 (Autonomous Planning)**: 在进入执行前自动建立实施方案，将宏大目标拆解为分阶段独立里程碑。
2. **长效执行 (Continuous Iteration)**: 自动执行文件读写、跨文件重构、依赖安装与环境配置。
3. **闭环自愈验证 (Automated Self-Healing & Verification)**: 每次修改后强制运行项目测试或构建验证，遇到编译错误或测试失败时自动捕获异常日志并迭代修复，直至完全通过。
4. **交付汇总 (Walkthrough Report)**: 目标达成后自动生成验收报告，呈现所有修改内容与实证记录。

### 📌 适用场景
- 通宵长任务或无人值守的大型重构任务
- 从零搭建完整的复杂功能模块或全栈项目
- 全量单元测试覆盖与持续缺陷自愈修复`,
  },
  {
    cmd: "/schedule",
    name: "定时与调度作业 (Schedule & Cron)",
    description: "按 Cron 表达式或指定单次倒计时运行指令，后台定时通知与状态巡检。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/schedule DurationSeconds=300 Prompt=\"...\" 或 CronExpression=\"*/5 * * * *\"",
    fullPrompt: `### ⏰ 指令定位与核心机制
\`/schedule\` 用于在 Antigravity 宿主环境中创建**单次延迟定时器**或**周期性 Cron 调度作业**。底层由 Antigravity 调度内核管理，到期自动向会话发送高优先级事件唤醒智能体。

### ⚙️ 参数与调用格式 (Parameters & Usage)
- **单次延迟提醒 (One-shot Timer)**:
  \`DurationSeconds=<秒数>\` \`Prompt="提醒或任务内容"\` \`TimerCondition="never|any|<taskId>"\`
- **周期性调度 (Recurring Cron)**:
  \`CronExpression="<标准5段式Cron>"\` \`Prompt="巡检内容"\` \`MaxIterations=<最大次数>\` \`IsDaemon=<true|false>\`

### 📌 适用场景
- 部署状态每隔 5 分钟轮询一次 (\`CronExpression="*/5 * * * *"\`)
- 耗时后台编译作业定时巡检或超时熔断
- 每天/每小时固定运行健康检查与状态汇报`,
  },
  {
    cmd: "/browser",
    name: "浏览器自动化控制 (Browser Automation)",
    description: "调用 Chrome DevTools 引擎执行网页任务、DOM 审查与抓取。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/browser <要浏览或测试的 URL>",
    fullPrompt: `### 🌐 指令定位与核心机制
\`/browser\` 唤起 Antigravity 的 **Chrome DevTools 自动化浏览与深度审查引擎**。智能体可直接控制真实浏览器会话完成网页导航、DOM 交互、网络分析与性能排查。

### ⚙️ 核心工具链与能力 (Core Tools)
- **页面导航与标签页管理**: \`navigate_page\`, \`new_page\`, \`close_page\`, \`list_pages\`
- **DOM 交互与表单**: \`click\`, \`fill\`, \`fill_form\`, \`hover\`, \`drag\`, \`press_key\`, \`type_text\`
- **审查与视觉快照**: \`take_screenshot\`, \`take_snapshot\`, \`lighthouse_audit\`
- **性能与网络诊断**: \`list_network_requests\`, \`list_console_messages\`, \`performance_start_trace\`

### 📌 适用场景
- 前端页面视觉走查、响应式断点测试与交互验证
- 网页数据抓取与 API 逆向分析
- Core Web Vitals (LCP/CLS) 与 Lighthouse 无障碍性能审计`,
  },
  {
    cmd: "/grill-me",
    name: "交互式需求细化对齐 (Grill Me Interview)",
    description: "通过交互式采访消解方案设计歧义，在动手前完全明确边界。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/grill-me",
    fullPrompt: `### 🎙️ 指令定位与核心机制
\`/grill-me\` 启动**交互式深度采访与需求对齐模式 (Interactive Alignment Interview)**。
在动手编写大篇幅代码或执行重大架构重构前，智能体会暂停直接实现，而是以资深架构师的视角向用户发起针对性的深度追问。

### ⚙️ 运行时行为规范
1. **边界条件探索**: 重点挖掘未明确的极端用例 (Edge Cases)、数据边界与性能指标要求。
2. **技术选型与权衡 (Trade-offs)**: 提出 2-3 种备选技术方案并分析各自利弊，协助用户明确取舍。
3. **架构方案固化**: 采访完成后自动输出清晰、无歧义的 \`implementation_plan.md\`，待用户确认后才正式开工。

### 📌 适用场景
- 复杂业务逻辑开发或未定型的重大技术重构
- 需求描述模糊、存在多种技术路径时的决策对齐`,
  },
  {
    cmd: "/teamwork-preview",
    name: "多智能体团队协作 (Multi-Agent Teamwork)",
    description: "调度多智能体协作网络共同攻克大型复合项目任务。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/teamwork-preview",
    fullPrompt: `### 👥 指令定位与核心机制
\`/teamwork-preview\` 启动**多智能体网络协作调度器 (Multi-Agent Swarm Orchestrator)**。
将复合型大型任务拆解并分发给多个具备不同专业分工的子智能体并发执行。

### ⚙️ 运行时行为规范
1. **专业角色分工**: 调度调研智能体 (\`research\`)、精准修改智能体 (\`cavecrew-builder\`)、代码评审智能体 (\`cavecrew-reviewer\`) 等。
2. **独立上下文隔离**: 每个子智能体拥有独立的思考上下文与分支工作区，避免单会话 Context 爆炸。
3. **成果聚合汇总**: 子智能体完成工作后，向主智能体输出高度浓缩的变更摘要与结构化产物。

### 📌 适用场景
- 跨多个微服务或大型仓库的并发重构
- 包含大范围代码调研、方案编写与多模块并行的复杂工程`,
  },
  {
    cmd: "/learn",
    name: "经验复盘与长效沉淀 (Knowledge Extraction)",
    description: "总结近期对话中的修复经验与代码习惯，沉淀为永久记忆规则。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/learn",
    fullPrompt: `### 🧠 指令定位与核心机制
\`/learn\` 触发**知识提炼与长效规则沉淀 (Knowledge Extraction & Rule Synthesis)**。
对当前对话中的关键调试经验、架构决策、环境配置及用户的个人编程偏好进行总结并沉淀为永久记忆。

### ⚙️ 运行时行为规范
1. **经验提炼**: 分析会话中用户纠正智能体的内容、特定的代码规范或疑难 Bug 的解决路径。
2. **规则持久化**: 自动格式化并写入 \`~/.gemini/config/\` 或工作区本地规则目录。
3. **跨会话继承**: 后续新会话启动时将自动加载沉淀的规则库，确保编程风格与规范的一致性。

### 📌 适用场景
- 解决了一套极其复杂的本地环境踩坑后，永久固化解决步骤
- 沉淀团队特有的代码风格、命名规范或 API 约定`,
  },
  {
    cmd: "/btw",
    name: "旁支速问速答 (By The Way Quick Ask)",
    description: "不打断主任务规划的前提下，快速咨询代码或环境问题。",
    category: "slash_builtin",
    source: "builtin",
    usage: "/btw <疑问内容>",
    fullPrompt: `### 💬 指令定位与核心机制
\`/btw\` 是**旁支速问速答通道 (By-The-Way Side Query)**。
允许用户在智能体执行主任务或保持长上下文的过程中，快速插入临时性的概念询问、语法查询或技术探讨。

### ⚙️ 运行时行为规范
1. **轻量即时响应**: 快速、简洁地解答用户的临时疑问。
2. **状态隔离保护**: 不打乱或污染当前主任务的执行规划与工具调用链。

### 📌 适用场景
- 任务执行过程中临时查询某 API 的参数定义或语法示例
- 不想打断长任务规划时的快速概念澄清`,
  },
];

const FRIENDLY_COMMAND_TRANSLATIONS: Record<
  string,
  { name: string; description: string; usage?: string; fullPrompt?: string }
> = {
  "/caveman-commit": {
    name: "caveman: 极简 Git 提交信息生成 (caveman-commit)",
    description: "基于当前已暂存的代码变更生成极简风格的 Conventional Commits 提交信息（重点说明原因而非废话）。",
    usage: "/caveman-commit",
    fullPrompt: `### 🎯 指令功能与规范
为当前已暂存的 Git 代码变更生成极简风格的提交信息（Conventional Commits 规范）。

### ⚙️ 格式要求
- **主题行 (Subject)**: ≤50 字符，祈使语气，类型后小写（如 \`feat: add user login\`），末尾不加句号。
- **正文 (Body)**: 仅在“为什么修改”不显而易见时才补充，重点解释修改原因 (Why) 而非罗列代码内容 (What)。`,
  },
  "/caveman-init": {
    name: "caveman: 写入常驻极简激活规则 (caveman-init)",
    description: "将常驻的 Caveman 极简交互与 Token 节省规则注入当前仓库，供所有 IDE 智能体生效。",
    usage: "/caveman-init [--force] [--dry-run]",
    fullPrompt: `### 🎯 指令功能与规范
在当前仓库中自动配置并写入常驻的 Caveman 极简交互规则文件。
- 优先使用 \`--dry-run\` 进行演练模拟，防止静默覆盖项目中已有的规则文件。
- 注入后当前工作区内的所有 IDE 智能体将默认遵循极简输出策略以节约 Token。`,
  },
  "/caveman-review": {
    name: "caveman: 单行极简代码评审 (caveman-review)",
    description: "对当前代码变更执行单行精简 Code Review（每条意见一句话，指出 Bug/风险/修复建议）。",
    usage: "/caveman-review",
    fullPrompt: `### 🎯 指令功能与规范
审查当前所有代码变更。对每一个发现的问题严格采用单行格式输出：
- **格式**: \`L<行号>: <严重等级> <问题描述>. <修复建议>.\`
- **严重等级分级**: \`bug\`(缺陷), \`risk\`(隐患), \`nit\`(细节瑕疵), \`q\`(技术疑问)。
- **规范**: 避免无意义客套赞美，跳过显而易见的内容。若代码完全正常，直接输出 \`LGTM\` 并结束。`,
  },
  "/caveman": {
    name: "caveman: 切换 Token 节省强度级别 (caveman)",
    description: "切换 Caveman 极简模式强度级别（lite / full / ultra / wenyan 文言），大幅节省上下文 Token。",
    usage: "/caveman [lite | full | ultra | wenyan]",
    fullPrompt: `### 🎯 指令功能与规范
切换智能体交互的 Caveman 极简输出模式。
- **可选级别**:
  - \`lite\`: 轻度精简，去除客套用语与冗余寒暄。
  - \`full\` (默认): 核心原始人风格，短句直述，去除填充词与冠词，保留精确代码与术语。
  - \`ultra\`: 极致压缩模式，最大化节省上下文 Token 预算。
  - \`wenyan\`: 文言雅简风，言简意赅。
- **输出模板**: \`[对象] [动作] [原因]. [下一步].\``,
  },
};

async function getDisabledCommands(): Promise<Set<string>> {
  const configPath = getConfigJsonPath();
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      if (Array.isArray(config.disabledCommands)) {
        const set = new Set<string>();
        for (const s of config.disabledCommands) {
          if (typeof s === "string") {
            const clean = s.startsWith("/") ? s : `/${s}`;
            set.add(clean);
            set.add(clean.slice(1));
          }
        }
        return set;
      }
    } catch {}
  }
  return new Set();
}

async function scanCommands(): Promise<CommandItem[]> {
  const disabledSet = await getDisabledCommands();

  const list: CommandItem[] = BUILTIN_SLASH_COMMANDS.map((c) => ({
    ...c,
    dirPath: "系统内置指令",
    enabled: !disabledSet.has(c.cmd),
  }));

  const home = getHomeDir();
  const pluginsDir = join(home, ".gemini", "config", "plugins");
  const userCmdDirs = [
    join(home, ".agents", "commands"),
    join(home, ".gemini", "config", "commands"),
  ];

  // 1. Scan User Custom Commands (~/.agents/commands and ~/.gemini/config/commands)
  for (const customCmdsDir of userCmdDirs) {
    if (existsSync(customCmdsDir)) {
      try {
        const files = await readdir(customCmdsDir);
        for (const f of files) {
          if (f.endsWith(".md") || f.endsWith(".toml")) {
            const fullPath = join(customCmdsDir, f);
            const cmdName = "/" + f.replace(/\.(toml|md)$/, "");
            if (list.some((existing) => existing.cmd === cmdName)) continue;

            let name = f.replace(/\.(toml|md)$/, "");
            let description = "用户自定义快捷指令";
            let argumentHint = "";
            let usage = cmdName;
            let fullPrompt = "";

            try {
              const content = await readFile(fullPath, "utf-8");
              if (f.endsWith(".toml")) {
                const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
                const descMatch = content.match(/description\s*=\s*["']([^"']+)["']/);
                const usageMatch = content.match(/usage\s*=\s*["']([^"']+)["']/);
                const argMatch = content.match(/argument-hint\s*=\s*["']([^"']+)["']/);
                const promptMatch = content.match(/prompt\s*=\s*["']([^"']+)["']/);
                if (nameMatch) name = nameMatch[1];
                if (descMatch) description = descMatch[1];
                if (argMatch) argumentHint = argMatch[1];
                if (usageMatch) usage = usageMatch[1];
                if (promptMatch) fullPrompt = promptMatch[1];
              } else if (f.endsWith(".md")) {
                const { data, body } = parseYamlFrontmatter(content);
                if (data.name) name = data.name;
                if (data.description) description = data.description;
                if (data["argument-hint"] || data.argumentHint) {
                  argumentHint = String(data["argument-hint"] || data.argumentHint);
                }
                if (data.usage) usage = data.usage;
                fullPrompt = body;
              }
            } catch {}

            if (argumentHint && (!usage || usage === cmdName)) {
              usage = `${cmdName} "${argumentHint}"`;
            }

            list.push({
              cmd: cmdName,
              name,
              description,
              argumentHint,
              category: "custom_command",
              source: "custom",
              usage,
              promptSnippet: (fullPrompt || description).slice(0, 100),
              fullPrompt: fullPrompt || description,
              path: fullPath,
              dirPath: customCmdsDir,
              enabled: !disabledSet.has(cmdName),
            });
          }
        }
      } catch {}
    }
  }

  // 2. Scan Plugin Commands
  if (existsSync(pluginsDir)) {
    try {
      const plugins = await readdir(pluginsDir, { withFileTypes: true });
      for (const p of plugins) {
        if (!p.isDirectory()) continue;
        const cmdDir = join(pluginsDir, p.name, "commands");
        if (existsSync(cmdDir)) {
          const files = await readdir(cmdDir);
          for (const f of files) {
            const fullPath = join(cmdDir, f);
            const cmdName = "/" + f.replace(/\.(toml|md|json)$/, "");
            if (list.some((existing) => existing.cmd === cmdName)) continue;

            let description = `${p.name} 提供的快捷指令`;
            let usage = cmdName;
            let argumentHint = "";
            let fullPrompt = "";
            let displayName = `${p.name}: ${f.replace(/\.\w+$/, "")}`;

            try {
              const content = await readFile(fullPath, "utf-8");
              if (f.endsWith(".toml")) {
                const descMatch = content.match(/description\s*=\s*["']([^"']+)["']/);
                const usageMatch = content.match(/usage\s*=\s*["']([^"']+)["']/);
                const argMatch = content.match(/argument-hint\s*=\s*["']([^"']+)["']/);
                const promptMatch = content.match(/prompt\s*=\s*["']([^"']+)["']/);
                if (descMatch) description = descMatch[1];
                if (argMatch) argumentHint = argMatch[1];
                if (usageMatch) usage = usageMatch[1];
                if (promptMatch) fullPrompt = promptMatch[1];
              } else if (f.endsWith(".md")) {
                const { data, body } = parseYamlFrontmatter(content);
                if (data.name) displayName = data.name;
                if (data.description) description = data.description;
                if (data["argument-hint"] || data.argumentHint) {
                  argumentHint = String(data["argument-hint"] || data.argumentHint);
                }
                if (data.usage) usage = data.usage;
                fullPrompt = body;
              }
            } catch {}

            // Apply Chinese translation if available
            const trans = FRIENDLY_COMMAND_TRANSLATIONS[cmdName];
            if (trans) {
              displayName = trans.name;
              description = trans.description;
              if (trans.usage) usage = trans.usage;
              if (trans.fullPrompt) fullPrompt = trans.fullPrompt;
            }

            list.push({
              cmd: cmdName,
              name: displayName,
              description,
              argumentHint,
              category: "plugin_command",
              source: "plugin",
              pluginName: p.name,
              usage,
              promptSnippet: (fullPrompt || description).slice(0, 100),
              fullPrompt: fullPrompt || description,
              path: fullPath,
              dirPath: cmdDir,
              enabled: !disabledSet.has(cmdName),
            });
          }
        }
      }
    } catch {}
  }

  return list;
}

export async function expandCustomCommand(rawText: string): Promise<string> {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("/")) return rawText;

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return rawText;

  const cmdName = match[1].toLowerCase();
  const cleanCmd = `/${cmdName}`;
  const args = (match[2] || "").trim();

  // Check if disabled
  const disabledSet = await getDisabledCommands();
  if (disabledSet.has(cleanCmd) || disabledSet.has(cmdName)) {
    return rawText;
  }

  // Native built-in slash commands handled directly by Antigravity runtime
  const nativeCmds = ["goal", "schedule", "browser", "grill-me", "teamwork-preview", "learn", "btw"];
  if (nativeCmds.includes(cmdName)) {
    return rawText;
  }

  const home = getHomeDir();
  const candidates = [
    join(home, ".agents", "commands", `${cmdName}.md`),
    join(home, ".agents", "commands", `${cmdName}.toml`),
    join(home, ".gemini", "config", "commands", `${cmdName}.md`),
    join(home, ".gemini", "config", "commands", `${cmdName}.toml`),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const content = await readFile(p, "utf-8");
        let body = content;
        if (p.endsWith(".md")) {
          const parsed = parseYamlFrontmatter(content);
          body = parsed.body || content;
        } else if (p.endsWith(".toml")) {
          const promptMatch = content.match(/prompt\s*=\s*["']([\s\S]*?)["']/);
          if (promptMatch) body = promptMatch[1];
        }

        if (body) {
          if (body.includes("$ARGUMENTS")) {
            return body.replace(/\$ARGUMENTS/g, args || "（无具体附加参数）");
          } else if (args) {
            return `${body}\n\n${args}`;
          } else {
            return body;
          }
        }
      } catch {}
    }
  }

  return rawText;
}

// ─────────────────────────────────────────────
// 7. Hooks (钩子)
// ─────────────────────────────────────────────

export interface HookItem {
  id: string;
  name: string;
  event: "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop";
  matcher?: string;
  command: string;
  args?: string[];
  runType?: string;
  timeout?: number;
  enabled: boolean;
  source: "config" | "plugin" | "workspace";
  filePath?: string;
  pluginName?: string;
}

async function scanHooks(workspaceUri?: string): Promise<HookItem[]> {
  const home = getHomeDir();
  const list: HookItem[] = [];

  const hookFiles: Array<{ source: "config" | "plugin" | "workspace"; path: string; pluginName?: string }> = [
    { source: "config" as const, path: join(home, ".gemini", "config", "hooks.json") },
  ];

  if (workspaceUri) {
    const cleanWorkspace = workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
    hookFiles.push({
      source: "workspace" as const,
      path: join(cleanWorkspace, ".agents", "hooks.json"),
    });
    const altWorkspaceHook = join(cleanWorkspace, ".gemini", "hooks.json");
    if (existsSync(altWorkspaceHook)) {
      hookFiles.push({ source: "workspace" as const, path: altWorkspaceHook });
    }
  }

  const pluginsDir = join(home, ".gemini", "config", "plugins");
  if (existsSync(pluginsDir)) {
    try {
      const plugins = await readdir(pluginsDir, { withFileTypes: true });
      for (const p of plugins) {
        if (p.isDirectory()) {
          const directHook = join(pluginsDir, p.name, "hooks.json");
          const subHook = join(pluginsDir, p.name, "hooks", "hooks.json");
          if (existsSync(directHook)) {
            hookFiles.push({
              source: "plugin" as const,
              path: directHook,
              pluginName: p.name,
            });
          }
          if (existsSync(subHook)) {
            hookFiles.push({
              source: "plugin" as const,
              path: subHook,
              pluginName: p.name,
            });
          }
        }
      }
    } catch {}
  }

  for (const hf of hookFiles) {
    if (existsSync(hf.path)) {
      try {
        const raw = JSON.parse(await readFile(hf.path, "utf-8"));
        const entries = (raw.hooks && typeof raw.hooks === "object" && !raw.PreToolUse && !raw.Stop)
          ? Object.entries(raw.hooks)
          : Object.entries(raw);

        for (const [hookName, hookDef] of entries) {
          if (typeof hookDef !== "object" || !hookDef) continue;
          const isEnabled = (hookDef as any).enabled !== false;

          const events: Array<"PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop"> = [
            "PreToolUse",
            "PostToolUse",
            "PreInvocation",
            "PostInvocation",
            "Stop",
          ];

          for (const ev of events) {
            const handlers = (hookDef as any)[ev];
            if (Array.isArray(handlers)) {
              for (let i = 0; i < handlers.length; i++) {
                const handler = handlers[i];
                if (handler.matcher && Array.isArray(handler.hooks)) {
                  for (let j = 0; j < handler.hooks.length; j++) {
                    const inner = handler.hooks[j];
                    const args = inner.args || (inner.argv ? (Array.isArray(inner.argv) ? inner.argv : [inner.argv]) : undefined);
                    list.push({
                      id: `${hf.source}-${hookName}-${ev}-${i}-${j}`,
                      name: hookName,
                      event: ev,
                      matcher: handler.matcher,
                      command: inner.command || inner.script || "shell command",
                      args: Array.isArray(args) ? args : undefined,
                      runType: inner.type || "command",
                      timeout: inner.timeout || 30,
                      enabled: isEnabled,
                      source: hf.source,
                      filePath: hf.path,
                      pluginName: (hf as any).pluginName,
                    });
                  }
                } else if (handler.command) {
                  const args = handler.args || (handler.argv ? (Array.isArray(handler.argv) ? handler.argv : [handler.argv]) : undefined);
                  list.push({
                    id: `${hf.source}-${hookName}-${ev}-${i}`,
                    name: hookName,
                    event: ev,
                    matcher: handler.matcher,
                    command: handler.command,
                    args: Array.isArray(args) ? args : undefined,
                    runType: handler.type || "command",
                    timeout: handler.timeout || 30,
                    enabled: isEnabled,
                    source: hf.source,
                    filePath: hf.path,
                    pluginName: (hf as any).pluginName,
                  });
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  return list;
}

// ─────────────────────────────────────────────
// Register All Agent Capabilities Routes
// ─────────────────────────────────────────────

export function registerAgentCapabilitiesRoutes(app: Hono): void {
  // 1. Memory routes
  app.get("/api/agent-capabilities/memory", async (c) => {
    try {
      const workspaceUri = c.req.query("workspaceUri");
      const data = await scanMemory(workspaceUri);
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/memory/save", async (c) => {
    try {
      const body = await c.req.json<{ path: string; content: string }>();
      if (!body.path || typeof body.content !== "string") {
        return c.json({ error: "Missing path or content" }, 400);
      }
      await writeFile(body.path, body.content, "utf-8");
      return c.json({ success: true, path: body.path });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 2. Plugins routes
  app.get("/api/agent-capabilities/plugins", async (c) => {
    try {
      const plugins = await scanPlugins();
      return c.json({ plugins, total: plugins.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/plugins/toggle", async (c) => {
    try {
      const body = await c.req.json<{ pluginId: string; enabled: boolean }>();
      if (!body.pluginId) {
        return c.json({ error: "Missing pluginId" }, 400);
      }
      const configPath = getConfigJsonPath();
      let config: Record<string, any> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(await readFile(configPath, "utf-8"));
        } catch {}
      }
      if (!config.plugins) config.plugins = {};
      config.plugins[body.pluginId] = { enabled: body.enabled };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      return c.json({ success: true, pluginId: body.pluginId, enabled: body.enabled });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/plugins/install", async (c) => {
    try {
      const body = await c.req.json<{ pluginId: string }>();
      if (!body.pluginId) {
        return c.json({ error: "Missing pluginId" }, 400);
      }
      const pluginId = body.pluginId;
      const home = getHomeDir();
      const pluginDir = join(home, ".gemini", "config", "plugins", pluginId);
      const info = GOOGLE_OFFICIAL_CATALOG[pluginId] || {
        displayName: pluginId,
        description: `Antigravity 扩展插件 (${pluginId})`,
        author: "Community",
      };

      await mkdir(pluginDir, { recursive: true });

      // 1. Write plugin.json
      const pluginJson = {
        name: info.displayName,
        description: info.description,
        version: "1.0.0",
        author: info.author,
      };
      await writeFile(join(pluginDir, "plugin.json"), JSON.stringify(pluginJson, null, 2), "utf-8");

      // 2. Write starter SKILL.md
      const skillsDir = join(pluginDir, "skills");
      const skillKey = pluginId.replace(/-plugin$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
      const specificSkillDir = join(skillsDir, skillKey);
      await mkdir(specificSkillDir, { recursive: true });

      const skillContent = `---
name: ${skillKey}
description: ${info.description}
---

# ${info.displayName}

${info.description}

## Usage Guidelines
- Reference this skill when working with ${info.displayName} components and APIs.
- Adhere to official Google engineering patterns and best practices.
`;
      await writeFile(join(specificSkillDir, "SKILL.md"), skillContent, "utf-8");

      // 3. Update config.json
      const configPath = getConfigJsonPath();
      let config: Record<string, any> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(await readFile(configPath, "utf-8"));
        } catch {}
      }
      if (!config.plugins) config.plugins = {};
      config.plugins[pluginId] = { enabled: true };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      return c.json({ success: true, pluginId, message: "Installed successfully" });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/plugins/uninstall", async (c) => {
    try {
      const body = await c.req.json<{ pluginId: string }>();
      if (!body.pluginId) {
        return c.json({ error: "Missing pluginId" }, 400);
      }
      const pluginId = body.pluginId;
      const home = getHomeDir();
      const pluginDir = join(home, ".gemini", "config", "plugins", pluginId);

      if (existsSync(pluginDir)) {
        await rm(pluginDir, { recursive: true, force: true });
      }

      const configPath = getConfigJsonPath();
      if (existsSync(configPath)) {
        try {
          const config = JSON.parse(await readFile(configPath, "utf-8"));
          if (config.plugins && config.plugins[pluginId]) {
            delete config.plugins[pluginId];
            await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
          }
        } catch {}
      }

      return c.json({ success: true, pluginId, message: "Uninstalled successfully" });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 3. Skills routes
  app.get("/api/agent-capabilities/skills", async (c) => {
    try {
      const home = getHomeDir();
      const configSkillsDir = join(home, ".gemini", "config", "skills");
      const builtinSkillsDir = join(home, ".gemini", "antigravity", "builtin", "skills");
      const pluginsDir = join(home, ".gemini", "config", "plugins");

      const [configSkills, builtinSkills] = await Promise.all([
        scanSkillsDir(configSkillsDir, "global"),
        scanSkillsDir(builtinSkillsDir, "builtin"),
      ]);

      const pluginSkills: SkillDetail[] = [];
      if (existsSync(pluginsDir)) {
        try {
          const plugins = await readdir(pluginsDir, { withFileTypes: true });
          for (const p of plugins) {
            if (p.isDirectory()) {
              const pSkills = await scanSkillsDir(join(pluginsDir, p.name, "skills"), "plugin", p.name);
              pluginSkills.push(...pSkills);
            }
          }
        } catch {}
      }

      const all = [...configSkills, ...builtinSkills, ...pluginSkills];
      return c.json({ skills: all, total: all.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/agent-capabilities/skills/content", async (c) => {
    try {
      const pathParam = c.req.query("path");
      if (!pathParam || !existsSync(pathParam)) {
        return c.json({ error: "Skill directory not found" }, 404);
      }
      const skillMdPath = join(pathParam, "SKILL.md");
      let markdown = "";
      if (existsSync(skillMdPath)) {
        markdown = await readFile(skillMdPath, "utf-8");
      }
      let scripts: string[] = [];
      const scriptsDir = join(pathParam, "scripts");
      if (existsSync(scriptsDir)) {
        try {
          scripts = await readdir(scriptsDir);
        } catch {}
      }
      let references: string[] = [];
      const refDir = join(pathParam, "references");
      if (existsSync(refDir)) {
        try {
          references = await readdir(refDir);
        } catch {}
      }
      return c.json({ markdown, scripts, references });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 4. Subagents routes
  app.get("/api/agent-capabilities/subagents", async (c) => {
    try {
      const subagents = await scanSubagents();
      return c.json({ subagents, total: subagents.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/subagents/create", async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        role: string;
        description: string;
        tools?: string[];
        systemPrompt: string;
      }>();

      if (!body.name || !body.name.trim()) {
        return c.json({ error: "智能体名称不能为空" }, 400);
      }

      const safeName = body.name.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "-");
      const home = getHomeDir();
      const globalAgentsDir = join(home, ".gemini", "config", "agents");
      await mkdir(globalAgentsDir, { recursive: true });

      const targetFile = join(globalAgentsDir, `${safeName}.md`);
      const tools = Array.isArray(body.tools) && body.tools.length > 0
        ? body.tools
        : ["read_file", "write_to_file", "run_command", "grep_search", "view_file"];

      const mdContent = `---
name: ${safeName}
role: ${body.role?.trim() || "用户自定义智能体"}
description: ${body.description?.trim() || "自定义专能智能体"}
tools: ${JSON.stringify(tools)}
---

${body.systemPrompt?.trim() || "You are a specialized subagent."}
`;

      await writeFile(targetFile, mdContent, "utf-8");
      return c.json({ success: true, path: targetFile, name: safeName });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/subagents/update", async (c) => {
    try {
      const body = await c.req.json<{
        path: string;
        name: string;
        role: string;
        description: string;
        tools?: string[];
        systemPrompt: string;
      }>();

      if (!body.path || !existsSync(body.path)) {
        return c.json({ error: "找不到目标智能体定义文件" }, 404);
      }

      const tools = Array.isArray(body.tools) && body.tools.length > 0
        ? body.tools
        : ["read_file", "write_to_file", "run_command", "grep_search", "view_file"];

      const mdContent = `---
name: ${body.name?.trim() || "custom-agent"}
role: ${body.role?.trim() || "用户自定义智能体"}
description: ${body.description?.trim() || ""}
tools: ${JSON.stringify(tools)}
---

${body.systemPrompt?.trim() || "You are a specialized subagent."}
`;

      await writeFile(body.path, mdContent, "utf-8");
      return c.json({ success: true, path: body.path });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/subagents/delete", async (c) => {
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path) {
        return c.json({ error: "缺少文件路径" }, 400);
      }
      if (existsSync(body.path)) {
        await rm(body.path, { force: true });
      }
      return c.json({ success: true, path: body.path });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/open-path", async (c) => {
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path) {
        return c.json({ error: "Missing path" }, 400);
      }
      const targetPath = body.path;
      const { spawn } = await import("node:child_process");

      if (process.platform === "win32") {
        if (existsSync(targetPath)) {
          spawn("explorer.exe", [`/select,${targetPath}`], { detached: true, stdio: "ignore" });
        } else {
          const parentDir = join(targetPath, "..");
          if (existsSync(parentDir)) {
            spawn("explorer.exe", [parentDir], { detached: true, stdio: "ignore" });
          }
        }
      } else if (process.platform === "darwin") {
        spawn("open", ["-R", targetPath], { detached: true, stdio: "ignore" });
      } else {
        const parentDir = join(targetPath, "..");
        spawn("xdg-open", [existsSync(targetPath) ? targetPath : parentDir], { detached: true, stdio: "ignore" });
      }

      return c.json({ success: true, path: targetPath });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 5. MCP Servers routes
  app.get("/api/agent-capabilities/mcp", async (c) => {
    try {
      const servers = await scanMcpServers();
      return c.json({ servers, total: servers.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/mcp/toggle", async (c) => {
    try {
      const body = await c.req.json<{ serverName: string; disabled: boolean }>();
      if (!body.serverName) {
        return c.json({ error: "Missing serverName" }, 400);
      }
      const mcpPath = getMcpConfigPath();
      let config: Record<string, any> = {};
      if (existsSync(mcpPath)) {
        try {
          config = JSON.parse(await readFile(mcpPath, "utf-8"));
        } catch {}
      }
      if (!config.mcpServers) config.mcpServers = {};
      if (config.mcpServers[body.serverName]) {
        if (body.disabled) {
          config.mcpServers[body.serverName].disabled = true;
        } else {
          delete config.mcpServers[body.serverName].disabled;
        }
      }
      await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf-8");
      return c.json({ success: true, serverName: body.serverName, disabled: body.disabled });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 6. Commands routes
  app.get("/api/agent-capabilities/commands", async (c) => {
    try {
      const commands = await scanCommands();
      return c.json({ commands, total: commands.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/commands/toggle", async (c) => {
    try {
      const body = await c.req.json<{ cmd: string; enabled: boolean }>();
      if (!body.cmd) {
        return c.json({ error: "Missing cmd" }, 400);
      }
      const configPath = getConfigJsonPath();
      let config: Record<string, any> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(await readFile(configPath, "utf-8"));
        } catch {}
      }
      const rawList: string[] = Array.isArray(config.disabledCommands) ? config.disabledCommands : [];
      const disabledSet = new Set<string>();
      for (const s of rawList) {
        if (typeof s === "string") {
          const clean = s.startsWith("/") ? s : `/${s}`;
          disabledSet.add(clean);
        }
      }
      const cleanCmd = body.cmd.startsWith("/") ? body.cmd : `/${body.cmd}`;
      if (body.enabled) {
        disabledSet.delete(cleanCmd);
        disabledSet.delete(cleanCmd.slice(1));
      } else {
        disabledSet.add(cleanCmd);
      }
      config.disabledCommands = Array.from(disabledSet);
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      return c.json({ success: true, cmd: body.cmd, enabled: body.enabled });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/commands/create", async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        cmd?: string;
        description?: string;
        usage?: string;
        argumentHint?: string;
        scope?: "user" | "workspace";
        workspaceUri?: string;
        prompt: string;
      }>();

      const rawCmd = (body.cmd || body.name || "").trim();
      if (!rawCmd || !body.prompt) {
        return c.json({ error: "Missing name/cmd or prompt" }, 400);
      }

      const cleanCmd = rawCmd.startsWith("/") ? rawCmd : `/${rawCmd}`;
      const cleanFileName = cleanCmd.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]/g, "_");

      const home = getHomeDir();
      let cmdDir = join(home, ".agents", "commands");
      if (body.scope === "workspace" && body.workspaceUri) {
        const cleanWs = body.workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
        cmdDir = join(cleanWs, ".agents", "commands");
      }
      await mkdir(cmdDir, { recursive: true });

      const filePath = join(cmdDir, `${cleanFileName}.md`);
      const argHint = (body.argumentHint || "").trim();
      const usage = body.usage || (argHint ? `${cleanCmd} ${argHint}` : cleanCmd);

      const fileContent = `---
name: ${body.name || cleanFileName}
description: ${body.description || ""}
${argHint ? `argument-hint: ${JSON.stringify(argHint)}\n` : ""}usage: ${usage}
category: ${body.scope === "workspace" ? "workspace_command" : "custom_command"}
---
${body.prompt}
`;

      await writeFile(filePath, fileContent, "utf-8");
      return c.json({ success: true, path: filePath });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/commands/update", async (c) => {
    try {
      const body = await c.req.json<{
        path: string;
        name: string;
        cmd?: string;
        description?: string;
        usage?: string;
        argumentHint?: string;
        prompt: string;
      }>();

      if (!body.path || !existsSync(body.path)) {
        return c.json({ error: "Command file not found" }, 404);
      }

      const rawCmd = (body.cmd || body.name || "").trim();
      const cleanCmd = rawCmd.startsWith("/") ? rawCmd : `/${rawCmd}`;
      const cleanFileName = cleanCmd.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const argHint = (body.argumentHint || "").trim();
      const usage = body.usage || (argHint ? `${cleanCmd} ${argHint}` : cleanCmd);

      const fileContent = `---
name: ${body.name || cleanFileName}
description: ${body.description || ""}
${argHint ? `argument-hint: ${JSON.stringify(argHint)}\n` : ""}usage: ${usage}
category: custom_command
---
${body.prompt}
`;

      await writeFile(body.path, fileContent, "utf-8");
      return c.json({ success: true, path: body.path });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/commands/delete", async (c) => {
    try {
      const body = await c.req.json<{ path: string }>();
      if (!body.path || !existsSync(body.path)) {
        return c.json({ error: "Command file not found" }, 404);
      }
      await unlink(body.path);
      return c.json({ success: true });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // 7. Hooks routes
  app.get("/api/agent-capabilities/hooks", async (c) => {
    try {
      const workspaceUri = c.req.query("workspaceUri");
      const hooks = await scanHooks(workspaceUri);
      return c.json({ hooks, total: hooks.length });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/hooks/create", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        event: "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop";
        scope?: "user" | "workspace";
        workspaceUri?: string;
        runType?: string;
        matcher?: string;
        command: string;
        args?: string[];
        timeout?: number;
        enabled?: boolean;
      }>();

      if (!body.command || !body.command.trim()) {
        return c.json({ error: "Hook command is required" }, 400);
      }

      const home = getHomeDir();
      let targetFile = join(home, ".gemini", "config", "hooks.json");
      if (body.scope === "workspace" && body.workspaceUri) {
        const cleanWs = body.workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
        const agentsDir = join(cleanWs, ".agents");
        if (!existsSync(agentsDir)) {
          await mkdir(agentsDir, { recursive: true });
        }
        targetFile = join(agentsDir, "hooks.json");
      } else {
        const configDir = join(home, ".gemini", "config");
        if (!existsSync(configDir)) {
          await mkdir(configDir, { recursive: true });
        }
      }

      let data: Record<string, any> = {};
      if (existsSync(targetFile)) {
        try {
          data = JSON.parse(await readFile(targetFile, "utf-8"));
        } catch {
          data = {};
        }
      }

      const hookName = (body.name?.trim() || `${body.event.toLowerCase()}-${Date.now().toString(36)}`);
      if (!data[hookName]) {
        data[hookName] = { enabled: body.enabled !== false };
      } else if (body.enabled !== undefined) {
        data[hookName].enabled = body.enabled;
      }

      const handlerObj: any = {
        type: body.runType || "command",
        command: body.command.trim(),
      };
      if (body.args && body.args.length > 0) handlerObj.args = body.args;
      if (body.timeout) handlerObj.timeout = Number(body.timeout);

      if (body.event === "PreToolUse" || body.event === "PostToolUse") {
        data[hookName][body.event] = [
          {
            matcher: body.matcher?.trim() || "*",
            hooks: [handlerObj],
          },
        ];
      } else {
        if (body.matcher && body.matcher.trim()) {
          data[hookName][body.event] = [
            {
              matcher: body.matcher.trim(),
              hooks: [handlerObj],
            },
          ];
        } else {
          data[hookName][body.event] = [handlerObj];
        }
      }

      await writeFile(targetFile, JSON.stringify(data, null, 2), "utf-8");
      return c.json({ success: true, path: targetFile, hookName });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/hooks/update", async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        originalName?: string;
        event: "PreToolUse" | "PostToolUse" | "PreInvocation" | "PostInvocation" | "Stop";
        originalEvent?: string;
        scope?: "user" | "workspace";
        workspaceUri?: string;
        filePath?: string;
        runType?: string;
        matcher?: string;
        command: string;
        args?: string[];
        timeout?: number;
        enabled?: boolean;
      }>();

      const home = getHomeDir();
      let targetFile = body.filePath;
      if (!targetFile || !existsSync(targetFile)) {
        if (body.scope === "workspace" && body.workspaceUri) {
          const cleanWs = body.workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
          targetFile = join(cleanWs, ".agents", "hooks.json");
        } else {
          targetFile = join(home, ".gemini", "config", "hooks.json");
        }
      }

      if (!existsSync(targetFile)) {
        return c.json({ error: "Hooks configuration file not found" }, 404);
      }

      let data: Record<string, any> = {};
      try {
        data = JSON.parse(await readFile(targetFile, "utf-8"));
      } catch {
        data = {};
      }

      const origName = body.originalName || body.name;
      if (origName && origName !== body.name && data[origName]) {
        delete data[origName];
      }

      const hookName = body.name.trim();
      if (!data[hookName]) {
        data[hookName] = { enabled: body.enabled !== false };
      } else if (body.enabled !== undefined) {
        data[hookName].enabled = body.enabled;
      }

      if (body.originalEvent && body.originalEvent !== body.event && data[hookName][body.originalEvent]) {
        delete data[hookName][body.originalEvent];
      }

      const handlerObj: any = {
        type: body.runType || "command",
        command: body.command.trim(),
      };
      if (body.args && body.args.length > 0) handlerObj.args = body.args;
      if (body.timeout) handlerObj.timeout = Number(body.timeout);

      if (body.event === "PreToolUse" || body.event === "PostToolUse") {
        data[hookName][body.event] = [
          {
            matcher: body.matcher?.trim() || "*",
            hooks: [handlerObj],
          },
        ];
      } else {
        if (body.matcher && body.matcher.trim()) {
          data[hookName][body.event] = [
            {
              matcher: body.matcher.trim(),
              hooks: [handlerObj],
            },
          ];
        } else {
          data[hookName][body.event] = [handlerObj];
        }
      }

      await writeFile(targetFile, JSON.stringify(data, null, 2), "utf-8");
      return c.json({ success: true, path: targetFile, hookName });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/hooks/toggle", async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        filePath?: string;
        scope?: "user" | "workspace";
        workspaceUri?: string;
        enabled: boolean;
      }>();

      const home = getHomeDir();
      let targetFile = body.filePath;
      if (!targetFile || !existsSync(targetFile)) {
        if (body.scope === "workspace" && body.workspaceUri) {
          const cleanWs = body.workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
          targetFile = join(cleanWs, ".agents", "hooks.json");
        } else {
          targetFile = join(home, ".gemini", "config", "hooks.json");
        }
      }

      if (!existsSync(targetFile)) {
        return c.json({ error: "Hooks configuration file not found" }, 404);
      }

      const data = JSON.parse(await readFile(targetFile, "utf-8"));
      if (data[body.name]) {
        data[body.name].enabled = body.enabled;
        await writeFile(targetFile, JSON.stringify(data, null, 2), "utf-8");
        return c.json({ success: true, enabled: body.enabled });
      }

      return c.json({ error: `Hook ${body.name} not found` }, 404);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/agent-capabilities/hooks/delete", async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        event?: string;
        filePath?: string;
        scope?: "user" | "workspace";
        workspaceUri?: string;
      }>();

      const home = getHomeDir();
      let targetFile = body.filePath;
      if (!targetFile || !existsSync(targetFile)) {
        if (body.scope === "workspace" && body.workspaceUri) {
          const cleanWs = body.workspaceUri.replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:)/, "$1");
          targetFile = join(cleanWs, ".agents", "hooks.json");
        } else {
          targetFile = join(home, ".gemini", "config", "hooks.json");
        }
      }

      if (!existsSync(targetFile)) {
        return c.json({ error: "Hooks configuration file not found" }, 404);
      }

      const data = JSON.parse(await readFile(targetFile, "utf-8"));
      if (data[body.name]) {
        if (body.event && Object.keys(data[body.name]).length > 2) {
          delete data[body.name][body.event];
        } else {
          delete data[body.name];
        }
        await writeFile(targetFile, JSON.stringify(data, null, 2), "utf-8");
        return c.json({ success: true });
      }

      return c.json({ error: `Hook ${body.name} not found` }, 404);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
