import { useEffect, useRef } from "react";
import { getFilePermissionRequest, getAskQuestionRequest } from "../utils/stepCards";
import { showBrowserNotification } from "../utils/browserNotifications";
import type { TrajectoryStep } from "../types";

const WAITING_STATUS = "CORTEX_STEP_STATUS_WAITING";

interface UseChatNotificationsOptions {
  cascadeId: string;
  steps: TrajectoryStep[];
  loading: boolean;
  wsRunning: boolean;
  isConversationRunning: boolean;
  enabled: boolean;
  conversationTitle?: string;
}

interface PendingApprovalNotification {
  key: string;
  title: string;
  body: string;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function cleanNotificationText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function latestAssistantReplyPreview(steps: TrajectoryStep[]): string | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step.type !== "CORTEX_STEP_TYPE_PLANNER_RESPONSE") continue;

    const response =
      step.plannerResponse?.modifiedResponse ??
      step.plannerResponse?.items
        ?.map((item) => (typeof item === "string" ? item : (item as any)?.text || (item as any)?.content || ""))
        .filter((text): text is string => Boolean(text?.trim()))
        .join("\n\n") ??
      "";
    const cleaned = cleanNotificationText(response);
    if (cleaned) return truncate(cleaned, 180);
  }

  return null;
}

function stepIdentity(step: TrajectoryStep, index: number): string {
  const info = step.metadata?.sourceTrajectoryStepInfo;
  const trajectoryId =
    info?.trajectoryId ?? step.metadata?.toolCall?.id ?? "local";
  const stepIndex = info?.stepIndex ?? index;
  return `${trajectoryId}:${stepIndex}`;
}

function pendingApprovalNotifications(
  steps: TrajectoryStep[],
): PendingApprovalNotification[] {
  const notifications: PendingApprovalNotification[] = [];

  steps.forEach((step, index) => {
    if (step.status !== WAITING_STATUS) return;

    const identity = stepIdentity(step, index);

    // 1. File permission approval
    const filePermissionRequest = getFilePermissionRequest(step);
    if (filePermissionRequest) {
      const path = filePermissionRequest.absolutePathUri.replace(
        /^file:\/\//,
        "",
      );
      notifications.push({
        key: `file:${identity}:${filePermissionRequest.absolutePathUri}`,
        title: "Porta 需要文件访问权限",
        body: truncate(path, 120),
      });
      return;
    }

    // 2. Multiple choice or user question
    const askRequest = getAskQuestionRequest(step);
    if (askRequest || step.type === "CORTEX_STEP_TYPE_ASK_QUESTION") {
      const qText =
        askRequest?.questions?.[0]?.question || "模型提出了待确认问题，请点击查看。";
      notifications.push({
        key: `ask:${identity}:${qText}`,
        title: "Porta 需要您做决策",
        body: truncate(qText, 120),
      });
      return;
    }

    // 3. Command execution approval
    if (step.type === "CORTEX_STEP_TYPE_RUN_COMMAND" && step.runCommand) {
      const command =
        step.runCommand.proposedCommandLine ??
        step.runCommand.commandLine ??
        step.runCommand.command ??
        "";

      notifications.push({
        key: `command:${identity}:${command}`,
        title: "Porta 需要审批",
        body: command ? truncate(command, 120) : "允许或拒绝命令。",
      });
      return;
    }
  });

  return notifications;
}

export function useChatNotifications({
  cascadeId,
  steps,
  loading,
  wsRunning,
  isConversationRunning,
  enabled,
  conversationTitle,
}: UseChatNotificationsOptions): void {
  const initializedRef = useRef(false);
  const seenApprovalKeysRef = useRef<Set<string>>(new Set());
  const prevWsRunningRef = useRef(wsRunning);
  const prevOverallRunningRef = useRef(wsRunning || isConversationRunning);
  const wasRunningRef = useRef(wsRunning || isConversationRunning);
  const runFinishedNotifiedRef = useRef(false);
  const cascadeRef = useRef(cascadeId);

  useEffect(() => {
    if (cascadeRef.current === cascadeId) return;

    cascadeRef.current = cascadeId;
    initializedRef.current = false;
    seenApprovalKeysRef.current = new Set();
    prevWsRunningRef.current = wsRunning;
    prevOverallRunningRef.current = wsRunning || isConversationRunning;
    wasRunningRef.current = wsRunning || isConversationRunning;
    runFinishedNotifiedRef.current = false;
  }, [cascadeId, isConversationRunning, wsRunning]);

  useEffect(() => {
    if (loading) return;

    const pendingApprovals = pendingApprovalNotifications(steps);
    const currentPendingKeys = pendingApprovals.map(({ key }) => key);

    const hasActiveSteps = steps.some((s) => {
      const status = String(s.status ?? "").toUpperCase();
      return (
        status.includes("RUNNING") ||
        status.includes("GENERATING") ||
        status.includes("PENDING") ||
        status.includes("QUEUED")
      );
    });

    const overallRunning = wsRunning || isConversationRunning || hasActiveSteps;

    if (!initializedRef.current) {
      initializedRef.current = true;
      seenApprovalKeysRef.current = new Set(currentPendingKeys);
      prevWsRunningRef.current = wsRunning;
      prevOverallRunningRef.current = overallRunning;
      wasRunningRef.current = overallRunning;
      return;
    }

    const startedRunning =
      (!prevWsRunningRef.current && wsRunning) ||
      (!prevOverallRunningRef.current && overallRunning);

    if (startedRunning || overallRunning) {
      wasRunningRef.current = true;
      runFinishedNotifiedRef.current = false;
    }

    const finishedRunning =
      (prevWsRunningRef.current && !wsRunning) ||
      (prevOverallRunningRef.current && !overallRunning) ||
      (wasRunningRef.current && !overallRunning);

    if (finishedRunning && !overallRunning && !runFinishedNotifiedRef.current && wasRunningRef.current) {
      if (enabled) {
        const latestReply = latestAssistantReplyPreview(steps);
        showBrowserNotification({
          title: "Porta 任务已完成",
          body:
            latestReply ??
            (conversationTitle
              ? `${conversationTitle} 当前已空闲。`
              : "当前会话已空闲。"),
          tag: `porta:${cascadeId}:run-finished`,
          soundKind: "complete",
        });
      }
      runFinishedNotifiedRef.current = true;
      wasRunningRef.current = false;
    }

    for (const notification of pendingApprovals) {
      if (seenApprovalKeysRef.current.has(notification.key)) continue;

      if (enabled) {
        showBrowserNotification({
          title: notification.title,
          body: notification.body,
          tag: `porta:${cascadeId}:${notification.key}`,
          soundKind: "attention",
        });
      }
      seenApprovalKeysRef.current.add(notification.key);
    }

    prevWsRunningRef.current = wsRunning;
    prevOverallRunningRef.current = overallRunning;
  }, [
    cascadeId,
    conversationTitle,
    enabled,
    isConversationRunning,
    loading,
    steps,
    wsRunning,
  ]);
}
