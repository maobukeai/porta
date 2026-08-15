import type { TrajectoryStep, ToolCallData, ChatMessage } from "../types";

export interface ArtifactItem {
  id: string;
  type: "doc" | "code" | "media" | "diff";
  title: string;
  content: string;
  language?: string;
  timestamp?: string;
  path?: string;
}

export function parseFilename(path?: string): { filename: string; ext: string } {
  if (!path) return { filename: "未命名产物", ext: "txt" };
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || normalized;
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "txt";
  return { filename, ext };
}

export function getFileBadge(path: string): string {
  const ext = parseFilename(path).ext.toUpperCase();
  if (ext.length > 4) return ext.slice(0, 4);
  return ext || "FILE";
}

function extractToolCallArtifacts(
  toolCall: ToolCallData,
  stepIndex: number,
  artifacts: ArtifactItem[],
  seenIds: Set<string>,
) {
  if (!toolCall || !toolCall.argumentsJson) return;

  try {
    const args = JSON.parse(toolCall.argumentsJson);
    const name = toolCall.name || "";

    // 1. write_to_file / create_file
    if (name.includes("write") || name.includes("create") || args.CodeContent) {
      const path = args.TargetFile || args.targetFile || args.path || args.filename;
      const { filename, ext } = parseFilename(path);
      const content = args.CodeContent || args.content || args.code || "";
      const isDoc = ["md", "txt", "markdown", "json", "yaml", "yml"].includes(ext);
      const id = `write-${stepIndex}-${filename}`;

      if (content && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: isDoc ? "doc" : "code",
          title: `${isDoc ? "文件/文档" : "代码文件"}: ${filename}`,
          content,
          path,
          language: ext,
        });
      }
    }

    // 2. replace_file_content / multi_replace_file_content
    if (name.includes("replace") || args.ReplacementContent || args.ReplacementChunks) {
      const path = args.TargetFile || args.targetFile || args.path;
      const { filename, ext } = parseFilename(path);
      let content = args.ReplacementContent || "";

      if (!content && Array.isArray(args.ReplacementChunks)) {
        content = args.ReplacementChunks.map(
          (c: any) => `// --- Line ${c.StartLine}-${c.EndLine} ---\n${c.ReplacementContent}`,
        ).join("\n\n");
      }

      const id = `diff-${stepIndex}-${filename}`;
      if (content && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: "diff",
          title: `代码修改: ${filename}`,
          content,
          path,
          language: ext,
        });
      }
    }

    // 3. run_command
    if (name.includes("command") || args.CommandLine) {
      const cmd = args.CommandLine || args.commandLine || args.command || "";
      const id = `cmd-${stepIndex}-${cmd.slice(0, 20)}`;
      if (cmd && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: "code",
          title: `Shell 指令 (${args.Cwd ? parseFilename(args.Cwd).filename : "终端"})`,
          content: cmd,
          language: "bash",
        });
      }
    }

    // 4. generate_image
    if (name.includes("image") || args.Prompt) {
      const prompt = args.Prompt || args.prompt || "";
      const imageName = args.ImageName || "generated_image";
      const id = `img-${stepIndex}-${imageName}`;
      if (prompt && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: "media",
          title: `生成的图像: ${imageName}`,
          content: `Prompt: ${prompt}`,
          language: "image",
        });
      }
    }
  } catch (e) {
    // Ignore JSON parse errors for non-JSON tool calls
  }
}

const artifactsCache = new Map<string, ArtifactItem[]>();
const MAX_ART_CACHE = 20;

function stepToken(step: TrajectoryStep | undefined): string {
  if (!step) return "_";
  const s = step as any;
  if (s.clientMessageId) return `cid:${s.clientMessageId}`;
  try {
    return JSON.stringify(step).slice(0, 120);
  } catch {
    return step.type ?? "_";
  }
}

function makeArtifactsFingerprint(steps: TrajectoryStep[], messages: ChatMessage[]): string {
  const stepsPart =
    steps.length === 0
      ? "0"
      : `${steps.length}:${stepToken(steps[0])}:${stepToken(steps[steps.length - 1])}`;
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const msgPart =
    messages.length === 0
      ? "0"
      : `${messages.length}:${firstMsg?.optimisticId ?? firstMsg?.stepIndex ?? firstMsg?.content?.slice(0, 30)}:${lastMsg?.optimisticId ?? lastMsg?.stepIndex ?? lastMsg?.content?.slice(0, 30)}`;
  return `${stepsPart}|${msgPart}`;
}

export function extractArtifactsFromSteps(
  steps: TrajectoryStep[] = [],
  messages: ChatMessage[] = [],
): ArtifactItem[] {
  if (steps.length === 0 && messages.length === 0) return [];

  const cacheKey = makeArtifactsFingerprint(steps, messages);
  if (artifactsCache.has(cacheKey)) {
    return artifactsCache.get(cacheKey)!;
  }

  const artifacts: ArtifactItem[] = [];
  const seenIds = new Set<string>();

  // 1. Process steps for Tool Calls and Planner Responses
  steps.forEach((step, stepIndex) => {
    if (step.metadata?.toolCall) {
      extractToolCallArtifacts(step.metadata.toolCall, stepIndex, artifacts, seenIds);
    }

    if (step.plannerResponse?.toolCalls) {
      step.plannerResponse.toolCalls.forEach((tc) =>
        extractToolCallArtifacts(tc, stepIndex, artifacts, seenIds),
      );
    }

    if (step.replaceFileContent) {
      const path = step.replaceFileContent.targetFile || "文件修改";
      const { filename, ext } = parseFilename(path);
      const content = step.replaceFileContent.replacementContent || "";
      const id = `diff-${stepIndex}-${filename}`;
      if (content && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: "diff",
          title: `代码修改: ${filename}`,
          content,
          path,
          language: ext,
        });
      }
    }

    if (step.writeFile) {
      const path = step.writeFile.targetFile || "产物文件";
      const { filename, ext } = parseFilename(path);
      const content = step.writeFile.content || "";
      const id = `write-${stepIndex}-${filename}`;
      if (content && !seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type: "doc",
          title: `产物文件: ${filename}`,
          content,
          path,
          language: ext,
        });
      }
    }

    const pr = step.plannerResponse;
    if (pr) {
      const responseText =
        pr.modifiedResponse ??
        pr.items
          ?.map((i) => i.text)
          .filter(Boolean)
          .join("\n\n") ??
        "";

      extractCodeBlocksFromText(responseText, stepIndex, artifacts, seenIds);
    }
  });

  // 2. Process messages (fallback/optimistic messages)
  messages.forEach((msg, msgIndex) => {
    if (msg.content) {
      extractCodeBlocksFromText(msg.content, msgIndex + 1000, artifacts, seenIds);
    }
  });

  if (artifactsCache.size >= MAX_ART_CACHE) {
    const oldestKey = artifactsCache.keys().next().value;
    if (oldestKey) artifactsCache.delete(oldestKey);
  }
  artifactsCache.set(cacheKey, artifacts);

  return artifacts;
}

function extractCodeBlocksFromText(
  text: string,
  index: number,
  artifacts: ArtifactItem[],
  seenIds: Set<string>,
) {
  // Fast bail-out: skip regex matching completely if text contains no code block fences
  if (!text || !text.includes("```")) return;

  const codeBlockRegex = /```([a-zA-Z0-9_+#-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || "text").toLowerCase();
    const codeContent = match[2].trim();

    if (codeContent.length > 5) {
      const isMermaid =
        lang === "mermaid" ||
        codeContent.startsWith("graph ") ||
        codeContent.startsWith("sequenceDiagram");
      const type = isMermaid ? "media" : lang === "markdown" || lang === "md" ? "doc" : "code";
      const title = isMermaid
        ? `架构/流程图 (Mermaid)`
        : `${lang.toUpperCase() || "代码"} 提取片段 (${codeContent.split("\n").length} 行)`;

      const id = `${type}-${index}-${codeContent.slice(0, 25).replace(/\s+/g, "_")}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        artifacts.push({
          id,
          type,
          title,
          content: codeContent,
          language: lang,
        });
      }
    }
  }
}
