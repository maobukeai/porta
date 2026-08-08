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
export function getFilePermissionRequest(
  step: TrajectoryStep,
): FilePermissionRequest | undefined {
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
  }

  if (!fpr && step.requestedInteraction?.permission) {
    const perm = (step.requestedInteraction as any).permission;
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
  }

  return fpr;
}

export function getAskQuestionRequest(
  step: TrajectoryStep,
): AskQuestionRequest | undefined {
  const directRequest = step.askQuestion ?? step.requestedInteraction?.askQuestion;
  if (directRequest?.questions && directRequest.questions.length > 0) {
    return directRequest;
  }

  // Extract MCP tool permission / options questions (e.g. blender-mcp/get_scene_info)
  const reqInteraction = step.requestedInteraction as any;
  const perm = reqInteraction?.permission ?? reqInteraction?.mcpPermission;
  const options = perm?.options ?? reqInteraction?.options;

  if (Array.isArray(options) && options.length > 0) {
    const res = perm?.resource;
    const target =
      res?.target ??
      res?.toolName ??
      perm?.target ??
      perm?.title ??
      reqInteraction?.target ??
      "MCP Tool";
    const actionStr = res?.action ?? perm?.action ?? "MCP tool";
    const title =
      perm?.title ??
      reqInteraction?.title ??
      `Allow using this ${actionStr}?`;

    return {
      questions: [
        {
          question: target && target !== title ? `${title}\n\`${target}\`` : title,
          options: options.map((opt: any, idx: number) => {
            if (typeof opt === "string") {
              return { id: String(idx + 1), text: opt };
            }
            return {
              id: opt.id ?? String(idx + 1),
              text: opt.text ?? String(opt),
            };
          }),
          isMultiSelect: false,
        },
      ],
    };
  }

  return undefined;
}
