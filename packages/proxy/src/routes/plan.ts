/**
 * /api/conversations/:id/plan route — Plan and Progress Tracker for Antigravity conversations.
 */

import type { Hono } from "hono";
import { readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const KNOWN_APP_DATA_DIRS = ["antigravity", "antigravity-ide"] as const;

export interface PlanTaskItem {
  id: string;
  index: number;
  title: string;
  icon?: string;
  status: "completed" | "running" | "pending";
  rawText: string;
}

export interface PlanMetadata {
  summary?: string;
  updatedAt?: string;
  requestFeedback?: boolean;
  userFacing?: boolean;
}

export interface ConversationPlanResponse {
  hasPlan: boolean;
  conversationId: string;
  title?: string;
  content?: string;
  metadata?: PlanMetadata;
  tasks: PlanTaskItem[];
  totalTasks: number;
  completedTasks: number;
  subagents: {
    total: number;
    completed: number;
    active: number;
  };
}

/**
 * Extracts emoji icon at start of string or within string.
 */
export function extractEmoji(text: string): { icon?: string; cleanTitle: string } {
  // Check for leading emoji
  const emojiMatch = text.match(/^([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*(.*)$/u);
  if (emojiMatch) {
    return {
      icon: emojiMatch[1],
      cleanTitle: emojiMatch[2].trim(),
    };
  }

  // Check for common ascii/bullet icons or symbols like ->, 🔧, 🧪, 🔔, 📎, 📅, 💎, ⚡, 🚀, 📦, 🎨, 📝, 🛡️, 🔍, ⚙️
  const commonEmoji = /(?:🔧|🧪|🔔|📎|📅|💎|⚡|🚀|📦|🎨|📝|🛡️|🔍|⚙️|✨|💡|🐛|🔨|📊|🎯|🏷️)/u;
  const match = text.match(commonEmoji);
  if (match) {
    const icon = match[0];
    const cleanTitle = text.replace(icon, "").replace(/^[:\-–—\s]+/, "").trim();
    return { icon, cleanTitle: cleanTitle || text };
  }

  return { cleanTitle: text };
}

/**
 * Parses markdown plan content into structured tasks.
 */
export function parsePlanMarkdown(content: string): { title?: string; tasks: PlanTaskItem[] } {
  if (!content || !content.trim()) {
    return { tasks: [] };
  }

  const lines = content.split("\n");
  let title: string | undefined;
  const tasks: PlanTaskItem[] = [];
  let taskIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Extract H1 title if not yet found
    if (!title && rawLine.startsWith("# ")) {
      title = rawLine.slice(2).replace(/^[#\s]+/, "").trim();
      continue;
    }

    // 1. Checklist item: `- [x] ...` or `- [ ] ...` or `* [x] ...`
    const checkboxMatch = rawLine.match(/^[-*]\s*\[([ xX/->])\]\s*(.*)$/);
    if (checkboxMatch) {
      taskIndex++;
      const mark = checkboxMatch[1];
      let taskText = checkboxMatch[2].trim();
      // Remove bold formatting if whole line is **Step X: ...**
      taskText = taskText.replace(/^\*\*([\s\S]*?)\*\*$/, "$1").trim();

      let status: "completed" | "running" | "pending" = "pending";
      if (
        mark === "x" ||
        mark === "X" ||
        taskText.includes("✅") ||
        taskText.includes("(done)") ||
        taskText.includes("(completed)") ||
        taskText.includes("(已完成)") ||
        rawLine.includes("~~")
      ) {
        status = "completed";
      } else if (
        mark === "/" ||
        mark === ">" ||
        mark === "-" ||
        taskText.includes("(in progress)") ||
        taskText.includes("(进行中)")
      ) {
        status = "running";
      }

      const { icon, cleanTitle } = extractEmoji(taskText);

      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status,
        rawText: taskText,
      });
      continue;
    }

    // 2. Active pointer step: `-> 🔧 ...` or `=> ...`
    const arrowMatch = rawLine.match(/^(?:->|=>|→)\s*(.*)$/);
    if (arrowMatch) {
      taskIndex++;
      const taskText = arrowMatch[1].trim().replace(/^\*\*([\s\S]*?)\*\*$/, "$1").trim();
      const { icon, cleanTitle } = extractEmoji(taskText);
      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status: "running",
        rawText: taskText,
      });
      continue;
    }

    // 3. Step Header: `### Step 1: ...` or `### 1. ...` or `#### [MODIFY] ...`
    const stepHeaderMatch = rawLine.match(/^#{2,4}\s+(?:Step\s*\d+[:.]?|\d+[.:])\s*(.*)$/i);
    if (stepHeaderMatch) {
      taskIndex++;
      const taskText = stepHeaderMatch[1].trim();
      const { icon, cleanTitle } = extractEmoji(taskText);
      tasks.push({
        id: `task-${taskIndex}`,
        index: taskIndex,
        title: cleanTitle || taskText,
        icon,
        status: "pending",
        rawText: taskText,
      });
      continue;
    }
  }

  // If no task was marked as 'running', find the first 'pending' task after any 'completed' task (or the very first task)
  const hasRunning = tasks.some((t) => t.status === "running");
  if (!hasRunning && tasks.length > 0) {
    const firstPendingIdx = tasks.findIndex((t) => t.status === "pending");
    if (firstPendingIdx !== -1) {
      // Mark as running if there are some completed tasks before it, or if it's the first step
      tasks[firstPendingIdx].status = "running";
    }
  }

  return { title, tasks };
}

/**
 * Scans the brain directory for real subagent tool calls.
 */
async function scanSubagentsForConversation(brainPath: string): Promise<{ total: number; completed: number; active: number }> {
  let total = 0;
  let completed = 0;
  let active = 0;

  try {
    const transcriptFile = join(brainPath, ".system_generated", "logs", "transcript.jsonl");
    const content = await readFile(transcriptFile, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      if (line.includes("invoke_subagent")) {
        try {
          const step = JSON.parse(line);
          const toolCalls = step.tool_calls || (step.metadata?.toolCall ? [step.metadata.toolCall] : []);
          for (const tc of toolCalls) {
            if (tc.name === "invoke_subagent" && tc.args?.Subagents) {
              let subs = tc.args.Subagents;
              if (typeof subs === "string") {
                try {
                  subs = JSON.parse(subs);
                } catch {}
              }
              if (Array.isArray(subs)) {
                total += subs.length;
                if (step.status === "RUNNING") {
                  active += subs.length;
                } else {
                  completed += subs.length;
                }
              }
            }
          }
        } catch {}
      }
    }
  } catch {
    // transcript not readable
  }

  return {
    total,
    completed,
    active,
  };
}

export function registerPlanRoutes(app: Hono): void {
  /**
   * GET /api/conversations/:id/plan
   * Reads implementation_plan.md and returns structured task progress.
   */
  app.get("/api/conversations/:id/plan", async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing conversation ID" }, 400);
    }

    for (const appDataDir of KNOWN_APP_DATA_DIRS) {
      const brainDir = join(homedir(), ".gemini", appDataDir, "brain", id);
      const planFile = join(brainDir, "implementation_plan.md");
      const metaFile = join(brainDir, "implementation_plan.md.metadata.json");

      try {
        await stat(planFile);
        const content = await readFile(planFile, "utf-8");

        let metadata: PlanMetadata | undefined;
        try {
          const metaRaw = await readFile(metaFile, "utf-8");
          metadata = JSON.parse(metaRaw) as PlanMetadata;
        } catch {
          // Metadata file optional
        }

        const { title, tasks } = parsePlanMarkdown(content);
        const subagents = await scanSubagentsForConversation(brainDir);
        const completedTasks = tasks.filter((t) => t.status === "completed").length;

        const response: ConversationPlanResponse = {
          hasPlan: true,
          conversationId: id,
          title: title || metadata?.summary || "任务规划",
          content,
          metadata,
          tasks,
          totalTasks: tasks.length,
          completedTasks,
          subagents,
        };

        return c.json(response);
      } catch {
        // implementation_plan.md does not exist in this appDataDir, try next
      }
    }

    // No plan file found on disk
    return c.json({
      hasPlan: false,
      conversationId: id,
      tasks: [],
      totalTasks: 0,
      completedTasks: 0,
      subagents: { total: 0, completed: 0, active: 0 },
    });
  });
}
