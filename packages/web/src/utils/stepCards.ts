import type {
  AskQuestionRequest,
  FilePermissionRequest,
  TrajectoryStep,
} from "../types";

/**
 * Extract a filePermissionRequest from any of the tool data fields
 * where the LS may embed it, or from the step's top-level field.
 *
 * The LS embeds filePermissionRequest in 6 step types:
 * CodeAction, ViewFile, ListDirectory, GrepSearch, ViewFileOutline, ViewCodeItem.
 */
/** Translate common permission/interactive question titles to natural Chinese */
export function formatQuestionTitleZh(title?: string): string {
  if (!title) return "";
  const t = title.trim();
  if (/^allow using this mcp tool\??/i.test(t)) return "是否允许使用此 MCP 工具？";
  if (
    /^allow reading \/ accessing this url\??/i.test(t) ||
    /^allow reading.*url\??/i.test(t) ||
    /^allow accessing.*url\??/i.test(t)
  ) {
    return "是否允许访问此网址？";
  }
  if (/^allow access to this resource\??/i.test(t)) return "是否允许访问此资源？";
  if (/^allow this action\??/i.test(t)) return "是否确认执行此操作？";
  return title;
}

/** Translate common standard options to clean Chinese */
export function formatOptionTextZh(text?: string): string {
  if (!text) return "";
  const t = text.trim();
  if (/^yes,\s*allow this time/i.test(t)) return "允许本次";
  if (/^yes,\s*and always allow in this conversation/i.test(t))
    return "在当前会话中始终允许";
  if (/^yes,\s*and always allow in this project/i.test(t))
    return "在当前项目中始终允许";
  if (/^yes,\s*and always allow/i.test(t)) return "始终允许";
  if (/^no\s*\(tell the agent/i.test(t)) return "拒绝（告知智能体替代操作）";
  if (/^no\s*\(deny/i.test(t)) return "拒绝访问";
  return text;
}

export function getAskQuestionRequest(
  step: TrajectoryStep,
): AskQuestionRequest | undefined {
  const directRequest =
    step.askQuestion ?? step.requestedInteraction?.askQuestion;
  if (directRequest?.questions && directRequest.questions.length > 0) {
    return {
      ...directRequest,
      questions: directRequest.questions.map((q) => ({
        ...q,
        question: formatQuestionTitleZh(q.question),
        options: q.options?.map((opt) => ({
          ...opt,
          text: formatOptionTextZh(opt.text),
        })),
      })),
    };
  }

  // Extract URL / MCP tool permission / options questions (e.g. Allow using this MCP tool? Allow reading this URL?)
  const reqInteraction = step.requestedInteraction as any;
  const perm =
    reqInteraction?.permission ??
    reqInteraction?.mcpPermission ??
    reqInteraction?.toolPermission ??
    reqInteraction?.urlPermission ??
    reqInteraction?.browserPermission ??
    reqInteraction?.resourcePermission ??
    (step.type === "CORTEX_STEP_TYPE_PERMISSION" ||
    step.type === "CORTEX_STEP_TYPE_REQUESTED_INTERACTION"
      ? reqInteraction
      : undefined);

  if (!perm && !reqInteraction) {
    return undefined;
  }

  const options =
    perm?.options ?? reqInteraction?.options ?? reqInteraction?.choices;

  const res = perm?.resource ?? reqInteraction?.resource;
  const serverName =
    res?.serverName ??
    res?.server ??
    perm?.serverName ??
    perm?.server ??
    reqInteraction?.serverName ??
    "";
  const toolName =
    res?.toolName ??
    res?.tool ??
    perm?.toolName ??
    perm?.tool ??
    reqInteraction?.toolName ??
    "";

  let target =
    res?.target ??
    res?.url ??
    res?.uri ??
    perm?.target ??
    perm?.url ??
    perm?.uri ??
    perm?.title ??
    reqInteraction?.target ??
    reqInteraction?.url ??
    "";

  if (!target && serverName && toolName) {
    target = `${serverName}/${toolName}`;
  } else if (!target && (toolName || serverName)) {
    target = toolName || serverName;
  }

  const actionStr = String(
    res?.action ?? perm?.action ?? reqInteraction?.action ?? "",
  ).toLowerCase();
  const isMcp = Boolean(
    serverName ||
      toolName ||
      actionStr.includes("mcp") ||
      actionStr.includes("tool") ||
      /mcp|tool|devtool|blender|github|prisma/i.test(target),
  );
  const isUrl = Boolean(
    target.startsWith("http://") ||
      target.startsWith("https://") ||
      actionStr.includes("url") ||
      actionStr.includes("browser"),
  );

  const hasOptions = Array.isArray(options) && options.length > 0;
  const isFileAccess =
    !hasOptions &&
    (actionStr === "read_file" ||
      actionStr === "write_file" ||
      actionStr === "file" ||
      (target.startsWith("file://") && !isMcp));

  if (isFileAccess) {
    return undefined;
  }

  if (hasOptions || isMcp || isUrl || perm?.title || reqInteraction?.title) {
    const rawTitle =
      perm?.title ??
      reqInteraction?.title ??
      (isMcp
        ? "是否允许使用此 MCP 工具？"
        : isUrl
          ? "是否允许访问此网址？"
          : target
            ? "是否允许访问此资源？"
            : "是否确认执行此操作？");

    const title = formatQuestionTitleZh(rawTitle);

    const defaultOptions =
      isMcp || isUrl
        ? [
            { id: "1", text: "允许本次" },
            { id: "2", text: "在当前会话中始终允许" },
            { id: "3", text: "在当前项目中始终允许" },
            { id: "4", text: "始终允许" },
            { id: "5", text: "拒绝（告知智能体替代操作）" },
          ]
        : [
            { id: "1", text: "允许本次" },
            { id: "2", text: "在当前会话中始终允许" },
            { id: "3", text: "始终允许" },
            { id: "5", text: "拒绝（告知智能体替代操作）" },
          ];

    const finalOptions = hasOptions
      ? options.map((opt: any, idx: number) => {
          if (typeof opt === "string") {
            return { id: String(idx + 1), text: formatOptionTextZh(opt) };
          }
          return {
            id: String(opt.id ?? idx + 1),
            text: formatOptionTextZh(opt.text ?? opt.label ?? String(opt)),
          };
        })
      : defaultOptions;

    return {
      questions: [
        {
          question:
            target && target !== title && !title.includes(target)
              ? `${title}\n${target}`
              : title,
          options: finalOptions,
          isMultiSelect: false,
        },
      ],
    };
  }

  return undefined;
}

export function getFilePermissionRequest(
  step: TrajectoryStep,
): FilePermissionRequest | undefined {
  // If the step has interactive options / choice questions or is an MCP/URL permission, it's an AskQuestion
  if (getAskQuestionRequest(step)) {
    return undefined;
  }

  let fpr =
    step.filePermissionRequest ??
    step.viewFile?.filePermissionRequest ??
    step.listDirectory?.filePermissionRequest ??
    step.codeAction?.filePermissionRequest ??
    step.grepSearch?.filePermissionRequest ??
    step.viewFileOutline?.filePermissionRequest ??
    step.viewCodeItem?.filePermissionRequest;

  if (fpr) {
    fpr = {
      ...fpr,
      action:
        fpr.action ?? (step.codeAction ? "write_file" : "read_file"),
      responseKind: "filePermission",
    };
    return fpr;
  }

  const reqInteraction = step.requestedInteraction as any;
  if (reqInteraction?.permission) {
    const perm = reqInteraction.permission;
    const res = perm?.resource;
    const target =
      res?.target ??
      res?.toolName ??
      res?.serverName ??
      perm?.target ??
      perm?.title ??
      "File Access";
    const action = res?.action ?? perm?.action ?? "file";
    fpr = {
      absolutePathUri: target,
      isDirectory: false,
      action: action,
      responseKind: "permission",
    };
    return fpr;
  }

  return undefined;
}

