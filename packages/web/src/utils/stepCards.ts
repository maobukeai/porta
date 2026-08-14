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
export function getAskQuestionRequest(
  step: TrajectoryStep,
): AskQuestionRequest | undefined {
  const directRequest =
    step.askQuestion ?? step.requestedInteraction?.askQuestion;
  if (directRequest?.questions && directRequest.questions.length > 0) {
    return directRequest;
  }

  // Extract URL / MCP tool permission / options questions (e.g. Allow reading this URL? zcode.z.ai)
  const reqInteraction = step.requestedInteraction as any;
  const perm =
    reqInteraction?.permission ??
    reqInteraction?.mcpPermission ??
    reqInteraction?.urlPermission ??
    reqInteraction;
  const options =
    perm?.options ?? reqInteraction?.options ?? reqInteraction?.choices;

  if (Array.isArray(options) && options.length > 0) {
    const res = perm?.resource ?? reqInteraction?.resource;
    const target =
      res?.target ??
      res?.url ??
      res?.toolName ??
      res?.serverName ??
      perm?.target ??
      perm?.url ??
      perm?.title ??
      reqInteraction?.target ??
      "";
    const actionStr = res?.action ?? perm?.action ?? "access";
    const title =
      perm?.title ??
      reqInteraction?.title ??
      (target ? `Allow reading / accessing this URL?` : `Allow using this ${actionStr}?`);

    return {
      questions: [
        {
          question:
            target && target !== title && !title.includes(target)
              ? `${title}\n${target}`
              : title,
          options: options.map((opt: any, idx: number) => {
            if (typeof opt === "string") {
              return { id: String(idx + 1), text: opt };
            }
            return {
              id: String(opt.id ?? idx + 1),
              text: opt.text ?? opt.label ?? String(opt),
            };
          }),
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
  // If the step has interactive options / choice questions, it's an AskQuestion
  const reqInteraction = step.requestedInteraction as any;
  const hasOptions =
    Array.isArray(reqInteraction?.permission?.options) ||
    Array.isArray(reqInteraction?.options) ||
    Array.isArray(reqInteraction?.choices) ||
    Boolean(step.askQuestion) ||
    Boolean(reqInteraction?.askQuestion);

  if (hasOptions) {
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

  if (reqInteraction?.permission) {
    const perm = reqInteraction.permission;
    const res = perm?.resource;
    const target =
      res?.target ??
      res?.toolName ??
      res?.serverName ??
      perm?.target ??
      perm?.title ??
      "Tool Access";
    const action = res?.action ?? perm?.action ?? "mcp_tool";
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

