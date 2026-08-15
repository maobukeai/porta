/**
 * /api/conversations/* routes
 */

import type { Hono } from "hono";
import type { LSInstance } from "../discovery.js";
import {
  discovery,
  rpc,
  conversationAffinity,
  conversationInstanceAffinity,
  uriToWorkspaceId,
  normalizeWorkspaceId,
  rpcForConversation,
  getStepCount,
} from "../routing.js";
import {
  extractConversationWorkspaces,
  conversationDirsForAppDataDirs,
  getMetadata,
  getPrimaryWorkspaceUri,
  scanDiskConversations,
  peekDiskConversationMetadata,
  readDiskConversationSteps,
  withNormalizedConversationWorkspaces,
  getProjectNameMap,
  syncProjectPermissionPreset,
  getProjectPermissionPreset,
  getAllKnownSubagentConversationIds,
} from "../metadata.js";
import { handleRPCError } from "../errors.js";
import { runConversationMutation } from "../conversation-mutations.js";
import { resolveModelIdentifier } from "./models.js";
import {
  oversizedStepOffset,
  isRecoverableStepError,
  findNextValidOffset,
  placeholderStep,
  MAX_SKIP,
} from "../step-recovery.js";
import { messageTracker } from "../message-tracker.js";
import { conversationSignals } from "../signals.js";
import { expandCustomCommand } from "./agentCapabilities.js";

const MAX_STEPS_LIMIT = 500;
const MAX_TOTAL_CONVERSATIONS = 100;

interface ConversationCandidate {
  id: string;
  modifiedAt: number;
  summary: Record<string, unknown>;
}

function parseConversationTime(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareConversationCandidates(
  a: ConversationCandidate,
  b: ConversationCandidate,
): number {
  return b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id);
}

// ── Background warm-up for disk-only conversations ──

/** Warm-up cache: cascadeId → timestamp when the warm-up was initiated. */
const warmedAt = new Map<string, number>();
/** How long a warm-up result is considered valid (ms). After this, the
 *  conversation will be re-warmed on the next poll if still disk-only.
 *  This handles LS restarts (conversations fall out of memory) and
 *  transient failures without manual intervention. */
const WARM_TTL_MS = 60_000;

function requestedWorkspaceUris(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.workspaceUris)) return [];
  return body.workspaceUris.filter(
    (uri): uri is string => typeof uri === "string" && uri.length > 0,
  );
}

async function discoverSingleWorkspaceUri(
  instances: LSInstance[],
): Promise<string | undefined> {
  const byWorkspaceId = new Map<string, string>();
  const addUri = (uri: string | undefined) => {
    if (!uri) return;
    byWorkspaceId.set(normalizeWorkspaceId(uriToWorkspaceId(uri)), uri);
  };

  await Promise.allSettled(
    instances.map(async (inst) => {
      try {
        const data = (await rpc.call("GetWorkspaceInfos", {}, inst)) as {
          workspaceInfos?: { workspaceUri?: string }[];
        };
        for (const info of data.workspaceInfos ?? []) addUri(info.workspaceUri);
      } catch {
        // Fallback below can still recover workspace metadata from summaries.
      }
    }),
  );

  await Promise.allSettled(
    instances.map(async (inst) => {
      try {
        const data = await rpc.call<{
          trajectorySummaries?: Record<string, Record<string, unknown>>;
        }>("GetAllCascadeTrajectories", {}, inst);
        for (const summary of Object.values(data.trajectorySummaries ?? {})) {
          for (const workspace of extractConversationWorkspaces(summary)) {
            addUri(workspace.workspaceFolderAbsoluteUri);
          }
        }
      } catch {
        // If summaries are unavailable, keep whatever GetWorkspaceInfos found.
      }
    }),
  );

  return byWorkspaceId.size === 1 ? [...byWorkspaceId.values()][0] : undefined;
}

/**
 * Fire-and-forget: touch each disk-only conversation on every LS so the LS
 * loads its .pb file into memory. On the *next* GetAllCascadeTrajectories call
 * the LS will return it with proper workspace metadata and summary.
 *
 * Uses GetCascadeTrajectorySteps with a huge offset so the LS loads the .pb
 * but returns only `{steps:[]}` (~28 bytes) instead of the full trajectory.
 *
 * HACK: There is no dedicated "load conversation" RPC on the LS. We rely on
 * the side-effect of GetCascadeTrajectorySteps loading the .pb from disk.
 * If the LS changes its boundary-check or authorization behavior, this may
 * silently stop working — watch for "warm-up: failed" log lines.
 *
 * Concurrency is capped to avoid flooding the LS with reads.
 */
function warmUpDiskConversations(
  ids: string[],
  instances: LSInstance[],
): void {
  const now = Date.now();
  const pending = ids.filter((id) => {
    const t = warmedAt.get(id);
    return !t || now - t > WARM_TTL_MS;
  });
  if (pending.length === 0) return;
  for (const id of pending) warmedAt.set(id, now);

  console.log(
    `[warm-up] loading ${pending.length} disk-only conversation(s) across ${instances.length} LS(es)`,
  );

  const CONCURRENCY = 10;

  void (async () => {
    let loaded = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (cascadeId) => {
          for (const inst of instances) {
            try {
              await rpc.call(
                "GetCascadeTrajectorySteps",
                { cascadeId, stepOffset: 999999 },
                inst,
              );
              loaded++;
              return;
            } catch {
              // This LS doesn't have it — try next
            }
          }
          failed++;
        }),
      );
    }

    if (failed > 0) {
      console.log(
        `[warm-up] done: ${loaded} loaded, ${failed} failed (no LS could load them)`,
      );
    } else {
      console.log(`[warm-up] done: ${loaded} loaded`);
    }
  })();
}


export function registerConversationRoutes(app: Hono): void {
  app.get("/api/conversations", async (c) => {
    try {
      const projectNameMap = await getProjectNameMap();
      const instances = await discovery.getInstances();
      const merged: Record<string, Record<string, unknown>> = {};

      // Build normalized set of workspaceIds served by running LS instances.
      // Normalization handles format differences between CLI --workspace_id
      // (e.g. file_e_3A_Work_novels) and URI-derived IDs (e.g. file_E:_Work_novels).
      const knownWsIds = new Set(
        instances
          .map((i) => i.workspaceId)
          .filter(Boolean)
          .map((id) => normalizeWorkspaceId(id!)),
      );

      await Promise.allSettled(
        instances.map(async (inst) => {
          try {
            const data = await rpc.call<{
              trajectorySummaries: Record<string, Record<string, unknown>>;
            }>("GetAllCascadeTrajectories", {}, inst);
            const summaries = data.trajectorySummaries ?? {};
            for (const [id, summary] of Object.entries(summaries)) {
              const normalizedSummary =
                withNormalizedConversationWorkspaces(summary);

              const projectId = (normalizedSummary.trajectoryMetadata as any)?.projectId;
              if (projectId) {
                const projectName = projectNameMap.get(projectId);
                if (projectName) {
                  (normalizedSummary as any).projectName = projectName;
                }
              }

              const wsUri = getPrimaryWorkspaceUri(normalizedSummary);
              if (wsUri) {
                conversationAffinity.set(id, uriToWorkspaceId(wsUri));
              }

              // Skip conversations whose workspace isn't served by any scoped
              // running LS. Antigravity 2.x exposes a hub LS with no
              // workspaceId; in that mode GetWorkspaceInfos has no
              // workspaceInfos, but GetAllCascadeTrajectories still contains
              // conversation workspace metadata. Such unscoped LS results must
              // pass through.
              if (
                inst.workspaceId &&
                wsUri &&
                !knownWsIds.has(normalizeWorkspaceId(uriToWorkspaceId(wsUri)))
              )
                continue;

              // NOTE: We intentionally do NOT inject the LS's workspace URI
              // into conversations that lack one. With warm-up loading .pb
              // files onto all LSes, the loading LS is not necessarily the
              // owner. Instead, we rely on the .pb itself containing the
              // correct workspace metadata — once warm-up loads it, the LS
              // returns it with genuine metadata on the next poll cycle.

              const existing = merged[id];
              const newCount = (normalizedSummary.stepCount as number) ?? 0;
              const oldCount = (existing?.stepCount as number) ?? -1;
              if (!existing || newCount > oldCount) {
                merged[id] = normalizedSummary;
              }
            }
          } catch {
            // Skip unreachable instances
          }
        }),
      );

      // Update affinity cache from merged results
      for (const [id, summary] of Object.entries(merged)) {
        const wsUri = getPrimaryWorkspaceUri(summary);
        if (wsUri) {
          conversationAffinity.set(id, uriToWorkspaceId(wsUri));
        }
        // NOTE: We intentionally do NOT learn affinity from the LS that returned
        // the summary when the conversation has no workspace metadata. With warm-up,
        // the owning LS is not necessarily the one that returned the summary.
        // Affinity is only learned from genuine workspace metadata in the
        // conversation itself — either from the .pb or from the LS that
        // originally created it.
      }

      // Also scan disk for conversations in the app-data tree used by the
      // running LS instances.
      const diskConversationDirs = conversationDirsForAppDataDirs(
        instances.map((inst) => inst.appDataDir),
      );
      const diskIds = await scanDiskConversations(
        diskConversationDirs.length > 0 ? diskConversationDirs : undefined,
      );

      const knownSubagentIds = await getAllKnownSubagentConversationIds();

      const isSubagentSummary = (summary: Record<string, unknown> | undefined, id?: string): boolean => {
        if (id && knownSubagentIds.has(id)) return true;
        if (!summary) return false;
        if (summary.isSubagent || summary._isSubagent) return true;
        const meta = summary.trajectoryMetadata as Record<string, unknown> | undefined;
        if (meta && (meta.isSubagent || meta.parentTrajectoryId || meta.parentCascadeId || meta.spawnedBy)) {
          return true;
        }
        const title = String(summary.summary || "");
        if (
          title.startsWith("[Subagent]") ||
          title.startsWith("subagent:") ||
          title.startsWith("子智能体") ||
          /^🤖\s*子智能体/i.test(title) ||
          /Usage Statistics Auditor/i.test(title) ||
          /数据统计功能代码审查/i.test(title)
        ) {
          return true;
        }
        return false;
      };

      // Rank LS and disk-only conversations together before applying the cap.
      const candidates: ConversationCandidate[] = [];

      for (const [id, summary] of Object.entries(merged)) {
        if (isSubagentSummary(summary, id)) continue;
        candidates.push({
          id,
          modifiedAt: parseConversationTime(summary.lastModifiedTime),
          summary,
        });
      }

      for (const diskId of diskIds) {
        if (!merged[diskId.id]) {
          let injectedWorkspaces: { workspaceFolderAbsoluteUri: string }[] = [];
          const wsId = conversationAffinity.get(diskId.id);
          if (wsId && wsId.startsWith("file_")) {
            const uri = wsId.replace(/^file_/, "file:///").replace(/_/g, "/");
            injectedWorkspaces = [{ workspaceFolderAbsoluteUri: uri }];
          }

          const peek = await peekDiskConversationMetadata(diskId.id);
          if (isSubagentSummary({ summary: peek.summary, isSubagent: (peek as any).isSubagent }, diskId.id)) {
            continue;
          }

          candidates.push({
            id: diskId.id,
            modifiedAt: parseConversationTime(diskId.mtime),
            summary: {
              summary: peek.summary || diskId.id.slice(0, 8) + "…",
              stepCount: peek.stepCount ?? 0,
              status: "CASCADE_RUN_STATUS_UNLOADED",
              lastModifiedTime: diskId.mtime,
              createdTime: diskId.mtime,
              trajectoryId: "",
              workspaces: injectedWorkspaces,
              _diskOnly: true,
            },
          });
        }
      }

      candidates.sort(compareConversationCandidates);

      // Inspect running conversations for active waiting interactions (askQuestion, filePermission, approval)
      const runningCandidates = candidates.filter(
        (c) => c.summary.status === "CASCADE_RUN_STATUS_RUNNING",
      );
      if (runningCandidates.length > 0) {
        await Promise.allSettled(
          runningCandidates.map(async (rc) => {
            try {
              const stepCount = (rc.summary.stepCount as number) || 1;
              const stepOffset = Math.max(0, stepCount - 1);
              const data = (await rpcForConversation(
                "GetCascadeTrajectorySteps",
                rc.id,
                { cascadeId: rc.id, stepOffset },
                undefined,
                true,
              )) as { steps?: Array<Record<string, unknown>> };
              const steps = data?.steps || [];
              const lastStep = steps[steps.length - 1];
              if (lastStep) {
                const sType = String(lastStep.type ?? "");
                const sStatus = String(lastStep.status ?? "").toUpperCase();
                const isCompleted =
                  Array.isArray(lastStep.completedInteractions) &&
                  lastStep.completedInteractions.length > 0;
                const isWaiting =
                  !isCompleted &&
                  !sStatus.includes("DONE") &&
                  !sStatus.includes("COMPLETE") &&
                  !sStatus.includes("CANCEL") &&
                  !sStatus.includes("ERROR") &&
                  (sType === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
                    sType === "CORTEX_STEP_TYPE_FILE_PERMISSION" ||
                    lastStep.requestedInteraction !== undefined ||
                    (sType === "CORTEX_STEP_TYPE_RUN_COMMAND" &&
                      sStatus.includes("WAITING")));
                if (isWaiting) {
                  rc.summary.isWaiting = true;
                }
              }
            } catch {}
          }),
        );
      }

      const finalMerged: Record<string, Record<string, unknown>> = {};
      const diskOnlyIds: string[] = [];

      for (const candidate of candidates.slice(0, MAX_TOTAL_CONVERSATIONS)) {
        finalMerged[candidate.id] = candidate.summary;
        if (candidate.summary._diskOnly) {
          diskOnlyIds.push(candidate.id);
        }
      }

      // Background warm-up: touch disk-only conversations so each LS loads
      // them from .pb files. Once loaded, GetAllCascadeTrajectories returns
      // them with proper workspace metadata on the next poll cycle.
      if (diskOnlyIds.length > 0 && instances.length > 0) {
        warmUpDiskConversations(diskOnlyIds, instances);
      }

      return c.json({ trajectorySummaries: finalMerged });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/conversations/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const data = await rpcForConversation("GetCascadeTrajectory", id, {
        cascadeId: id,
      }, undefined, true);
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/conversations/:id/steps", async (c) => {
    const id = c.req.param("id");
    let offset = parseInt(c.req.query("offset") ?? "0", 10);
    if (isNaN(offset) || offset < 0) offset = 0;
    const limitParam = c.req.query("limit");
    let limit = limitParam ? parseInt(limitParam, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      limit = 100;
    }
    if (limit !== undefined) {
      limit = Math.min(limit, MAX_STEPS_LIMIT);
    }

    let resolvedOffset = offset;
    let targetCount = limit ?? 100;

    try {
      let stepCount: number | undefined;
      let pinnedInstance: LSInstance | undefined;
      let stepsArray: unknown[] = [];

      if (c.req.query("tail")) {
        // readOnly=true: this endpoint only reads steps; the pinned instance
        // is NOT reused for mutations, so try-all fallback is safe and
        // necessary for disk-only conversations that no LS has in memory yet.
        const sc = await getStepCount(id, undefined, true);
        pinnedInstance = sc.instance;
        if (sc.count > 0) {
          stepCount = sc.count;
          let tailSize = parseInt(c.req.query("tail")!, 10);
          if (isNaN(tailSize) || tailSize <= 0) {
            tailSize = 100;
          }
          tailSize = Math.min(tailSize, MAX_STEPS_LIMIT);
          resolvedOffset = Math.max(0, stepCount - tailSize);
        }
      }

      // We need to fetch until we get what we came for, or we run out of steps.
      let currentOffset = resolvedOffset;
      targetCount = limit ?? (stepCount ? stepCount - resolvedOffset : 100);
      targetCount = Math.min(targetCount, MAX_STEPS_LIMIT);
      let consecutiveSkips = 0;

      const pushPlaceholders = (count: number, reason: string) => {
        const remainingTarget = targetCount - stepsArray.length;
        const remainingSkips = MAX_SKIP - consecutiveSkips;
        const placeholderCount = Math.max(
          0,
          Math.min(count, remainingTarget, remainingSkips),
        );
        for (let s = 0; s < placeholderCount; s++) {
          stepsArray.push(placeholderStep(reason));
        }
      };

      while (stepsArray.length < targetCount) {
        try {
          const data = await rpcForConversation<{ steps?: unknown[] }>(
            "GetCascadeTrajectorySteps",
            id,
            {
              cascadeId: id,
              stepOffset: currentOffset,
            },
            pinnedInstance,
            true,
          );

          const chunk = data.steps ?? [];
          if (chunk.length === 0) break;

          stepsArray.push(...chunk);
          currentOffset += chunk.length;
          consecutiveSkips = 0;
        } catch (fetchErr) {
          const badOffset = oversizedStepOffset(fetchErr);
          if (badOffset >= 0) {
            // Known oversized step — skip directly
            const skipCount = badOffset - currentOffset + 1;
            pushPlaceholders(
              skipCount,
              "Language Server: step exceeds 4MB protobuf limit",
            );
            currentOffset = badOffset + 1;
            consecutiveSkips += skipCount;
            if (consecutiveSkips >= MAX_SKIP) break;
          } else if (isRecoverableStepError(fetchErr)) {
            // Corrupted batch (e.g. invalid UTF-8) — binary search forward
            if (stepCount === undefined) {
              const sc = await getStepCount(id, undefined, true);
              stepCount = sc.count;
              pinnedInstance ??= sc.instance;
            }
            const nextValid = await findNextValidOffset(
              id,
              currentOffset + 1,
              stepCount,
              pinnedInstance,
            );
            const skipCount = nextValid - currentOffset;
            pushPlaceholders(
              skipCount,
              "Language Server: invalid UTF-8 in step data",
            );
            console.log(
              `Skipping corrupted range [${currentOffset}, ${nextValid - 1}] (${skipCount} steps)`,
            );
            currentOffset = nextValid;
            consecutiveSkips += skipCount;
            if (consecutiveSkips >= MAX_SKIP) break;
          } else {
            throw fetchErr;
          }
        }
      }

      // If we overfetched because of chunks, slice it down to the exact limit requested
      if (stepsArray.length > targetCount) {
        stepsArray = stepsArray.slice(0, targetCount);
      }

      return c.json({
        steps: messageTracker.annotateSteps(id, resolvedOffset, stepsArray),
        offset: resolvedOffset,
        ...(stepCount !== undefined ? { stepCount } : {}),
      });
    } catch (err) {
      try {
        const diskResult = await readDiskConversationSteps(id, resolvedOffset, targetCount);
        if (diskResult && diskResult.steps.length > 0) {
          return c.json({
            steps: messageTracker.annotateSteps(id, diskResult.offset, diskResult.steps),
            offset: diskResult.offset,
            stepCount: diskResult.stepCount,
            _fromDisk: true,
          });
        }
      } catch {
        // ignore disk fallback error
      }

      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations", async (c) => {
    try {
      const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<
        string,
        unknown
      >;
      const metadata = await getMetadata(!!body.fileAccessGranted);

      const bodyWorkspaceUris = requestedWorkspaceUris(body);
      const isStandaloneTask =
        body.noWorkspace === true ||
        body.workspaceFolderAbsoluteUri === null ||
        body.workspaceFolderAbsoluteUri === "";

      let workspaceUri: string | undefined =
        !isStandaloneTask &&
        typeof body.workspaceFolderAbsoluteUri === "string" &&
        body.workspaceFolderAbsoluteUri.trim() !== ""
          ? body.workspaceFolderAbsoluteUri
          : !isStandaloneTask
            ? bodyWorkspaceUris[0]
            : undefined;
      const instances = await discovery.getInstances();

      // Resolve which LS instance to use based on workspace URI
      let targetInstance: LSInstance | undefined;
      if (isStandaloneTask) {
        targetInstance = instances[0];
        workspaceUri = undefined;
      } else if (workspaceUri) {
        const wsId = normalizeWorkspaceId(uriToWorkspaceId(workspaceUri));
        targetInstance =
          instances.find(
            (i) => i.workspaceId && normalizeWorkspaceId(i.workspaceId) === wsId,
          ) ?? undefined;
        targetInstance ??=
          instances.filter((i) => !i.workspaceId).length === 1
            ? instances.find((i) => !i.workspaceId)
            : undefined;

        // Workspace was explicitly requested but no LS owns it — fail clearly
        if (!targetInstance) {
          return c.json(
            {
              error:
                "No Language Server found for this workspace. Open the project in Antigravity first.",
              detail: workspaceUri,
            },
            503,
          );
        }
      } else {
        // No workspace specified and not standalone
        targetInstance = instances[0];
        workspaceUri = await discoverSingleWorkspaceUri(instances);
      }

      const startWorkspaceUris = isStandaloneTask
        ? []
        : bodyWorkspaceUris.length > 0
          ? bodyWorkspaceUris
          : workspaceUri
            ? [workspaceUri]
            : [];

      const data = await rpc.call(
        "StartCascade",
        {
          ...body,
          metadata,
          source:
            typeof body.source === "string"
              ? body.source
              : "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
          ...(workspaceUri ? { workspaceFolderAbsoluteUri: workspaceUri } : {}),
          ...(startWorkspaceUris.length > 0
            ? { workspaceUris: startWorkspaceUris }
            : {}),
        },
        targetInstance,
      );

      // Learn affinity immediately
      const newId = (data as Record<string, unknown>)?.cascadeId as
        | string
        | undefined;
      if (newId && workspaceUri) {
        conversationAffinity.set(newId, uriToWorkspaceId(workspaceUri));
      } else if (newId && targetInstance?.workspaceId) {
        conversationAffinity.set(newId, targetInstance.workspaceId);
      }
      if (newId && targetInstance && !targetInstance.workspaceId) {
        conversationInstanceAffinity.set(newId, targetInstance);
      }

      // Signal WS connections for this conversation to enter ACTIVE state
      if (newId) conversationSignals.emit("activate", newId);

      return c.json(data, 201);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations/:id/messages", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const body = await c.req.json();
        const { items, model, media, plannerType, executionMode, clientMessageId } = body;
        const isReviewBeforeEdit = executionMode === "review_before_edit";
        const metadata = await getMetadata(!isReviewBeforeEdit && !!body.fileAccessGranted);
        
        let permissionPresetNum = 0;
        let presetEnumStr = "AGENT_PERMISSION_PRESET_UNSPECIFIED";
        if (executionMode === "review_before_edit") {
          permissionPresetNum = 1; // AGENT_PERMISSION_PRESET_REQUEST_REVIEW
          presetEnumStr = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
          metadata.permissionPreset = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
          metadata.allowFileAccess = false;
          metadata.allWorkspaceTrustGranted = false;
        } else if (executionMode === "full_access") {
          permissionPresetNum = 4; // AGENT_PERMISSION_PRESET_TURBO
          presetEnumStr = "AGENT_PERMISSION_PRESET_TURBO";
          metadata.permissionPreset = "AGENT_PERMISSION_PRESET_TURBO";
          metadata.allowFileAccess = true;
          metadata.allWorkspaceTrustGranted = true;
        } else if (executionMode === "auto_edit") {
          permissionPresetNum = 2; // AGENT_PERMISSION_PRESET_DEFAULT
          presetEnumStr = "AGENT_PERMISSION_PRESET_DEFAULT";
          metadata.permissionPreset = "AGENT_PERMISSION_PRESET_DEFAULT";
          metadata.allowFileAccess = true;
          metadata.allWorkspaceTrustGranted = true;
        } else if (executionMode === "planning") {
          permissionPresetNum = 1; // AGENT_PERMISSION_PRESET_REQUEST_REVIEW
          presetEnumStr = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
          metadata.permissionPreset = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
          metadata.allowFileAccess = false;
          metadata.allWorkspaceTrustGranted = false;
        }

        const { count: preSendStepCount, instance } = await getStepCount(id);

        try {
          const summary = (await rpc.call(
            "GetCascadeTrajectorySummary",
            { cascadeId: id },
            instance,
          )) as Record<string, unknown>;
          const wsUri = getPrimaryWorkspaceUri(summary);
          if (wsUri && presetEnumStr) {
            await syncProjectPermissionPreset(wsUri, presetEnumStr);
          }
        } catch {
          // ignore sync error
        }

        const effectivePlannerType =
          plannerType === "planning" || executionMode === "planning"
            ? "planning"
            : "conversational";

        const expandedItems = Array.isArray(items)
          ? await Promise.all(
              items.map(async (item: any) => {
                if (typeof item?.text === "string" && item.text.trim().startsWith("/")) {
                  const expanded = await expandCustomCommand(item.text);
                  return { ...item, text: expanded };
                }
                return item;
              }),
            )
          : items;

        const req: Record<string, unknown> = {
          metadata,
          cascadeId: id,
          items: expandedItems,
        };

        if (media && Array.isArray(media) && media.length > 0) {
          req.media = media.map((m: any) => {
            if (typeof m === "string") {
              let str = m;
              if (str.startsWith("data:")) {
                const comma = str.indexOf(",");
                if (comma !== -1) str = str.slice(comma + 1);
              }
              return { mimeType: "image/png", inlineData: str };
            }
            const mimeType = m.mimeType || m.mime_type || m.type || "image/png";
            let inlineData =
              m.inlineData ||
              m.inline_data ||
              m.data ||
              m.bytes ||
              m.base64 ||
              (m.payload?.case === "inlineData" ? m.payload.value : "") ||
              "";
            if (typeof inlineData === "string" && inlineData.startsWith("data:")) {
              const comma = inlineData.indexOf(",");
              if (comma !== -1) inlineData = inlineData.slice(comma + 1);
            }
            return {
              mimeType,
              inlineData,
            };
          });
        }

        const typeConfig =
          effectivePlannerType === "planning"
            ? { planning: {} }
            : { conversational: {} };

        const resolvedModel = await resolveModelIdentifier(model);
        req.cascadeConfig = {
          plannerConfig: {
            plannerTypeConfig: typeConfig,
            requestedModel: { model: resolvedModel },
            permissionPreset: permissionPresetNum,
          },
        };

        const data = await rpcForConversation(
          "SendUserCascadeMessage",
          id,
          req,
          instance,
        );
        if (typeof clientMessageId === "string" && clientMessageId.length > 0) {
          messageTracker.trackPendingMessage(
            id,
            clientMessageId,
            preSendStepCount,
          );
        }
        conversationSignals.emit("activate", id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Stop ──

  app.post("/api/conversations/:id/stop", async (c) => {
    const id = c.req.param("id");
    try {
      const data = await rpcForConversation("CancelCascadeInvocation", id, {
        cascadeId: id,
      });
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Delete ──

  app.delete("/api/conversations/:id", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const metadata = await getMetadata(true);
        const data = await rpcForConversation("DeleteCascadeTrajectory", id, {
          metadata,
          cascadeId: id,
        });
        messageTracker.clearConversation(id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Revert ──

  // ── File Permission ──

  app.post("/api/conversations/:id/file-permission", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { trajectoryId, stepIndex, allow, scope, absolutePathUri } = body;

      if (
        !trajectoryId ||
        stepIndex === undefined ||
        absolutePathUri === undefined
      ) {
        return c.json(
          {
            error:
              "Missing required fields: trajectoryId, stepIndex, absolutePathUri",
          },
          400,
        );
      }

      // Build HandleCascadeUserInteraction request with exact protobuf structure.
      // CRITICAL: top-level field is "interaction" (not "userInteraction"),
      // and it MUST include trajectoryId + stepIndex alongside filePermission.
      const data = await rpcForConversation(
        "HandleCascadeUserInteraction",
        id,
        {
          cascadeId: id,
          interaction: {
            trajectoryId,
            stepIndex: Number(stepIndex),
            filePermission: {
              allow: !!allow,
              scope: Number(scope) || 0,
              absolutePathUri,
            },
          },
        },
      );

      // Permission approval unblocks subsequent WAITING steps — wake WS polling
      conversationSignals.emit("activate", id);

      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Command Action (approve/reject proposed commands) ──

  app.post("/api/conversations/:id/command-action", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { trajectoryId, stepIndex, approved } = body;

      if (!trajectoryId || stepIndex === undefined) {
        return c.json(
          {
            error:
              "Missing required fields: trajectoryId, stepIndex",
          },
          400,
        );
      }

      // Use HandleCascadeUserInteraction with commandAction field.
      // Same RPC as filePermission, different interaction type.
      const data = await rpcForConversation(
        "HandleCascadeUserInteraction",
        id,
        {
          cascadeId: id,
          interaction: {
            trajectoryId,
            stepIndex: Number(stepIndex),
            permission: {
              allow: !!approved,
            },
          },
        },
      );

      // Command approval/rejection unblocks the agent — wake WS polling
      conversationSignals.emit("activate", id);

      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Ask Question (Antigravity choice prompts) ──

  app.post("/api/conversations/:id/ask-question", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { trajectoryId, stepIndex, responses, cancelled } = body;

      if (!trajectoryId || stepIndex === undefined) {
        return c.json(
          {
            error: "Missing required fields: trajectoryId, stepIndex",
          },
          400,
        );
      }

      const firstResponse = Array.isArray(responses) ? responses[0] : undefined;
      const selectedId = firstResponse?.selectedOptionIds?.[0] ?? "1";
      const isDeny =
        selectedId === "5" ||
        selectedId === "deny" ||
        selectedId === "no" ||
        cancelled;
      const scopeNum = parseInt(selectedId, 10) || 1;

      let data: unknown;
      let lastErr: unknown;

      try {
        data = await rpcForConversation(
          "HandleCascadeUserInteraction",
          id,
          {
            cascadeId: id,
            interaction: {
              trajectoryId,
              stepIndex: Number(stepIndex),
              askQuestion: {
                responses: Array.isArray(responses) ? responses : [],
                cancelled: !!cancelled,
              },
            },
          },
        );
      } catch (err1) {
        lastErr = err1;
        try {
          // Fallback for permission-style interactions (e.g. MCP tool, URL/resource permissions)
          data = await rpcForConversation(
            "HandleCascadeUserInteraction",
            id,
            {
              cascadeId: id,
              interaction: {
                trajectoryId,
                stepIndex: Number(stepIndex),
                permission: {
                  allow: !isDeny,
                  scope: isDeny ? 0 : scopeNum,
                  ...(firstResponse?.writeInResponse
                    ? { feedback: firstResponse.writeInResponse }
                    : {}),
                },
              },
            },
          );
        } catch (err2) {
          throw lastErr || err2;
        }
      }

      conversationSignals.emit("activate", id);

      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/conversations/:id/revert-preview", async (c) => {
    const id = c.req.param("id");
    const stepIndex = Number(c.req.query("stepIndex") ?? 0);
    try {
      const data = (await rpcForConversation("GetRevertPreview", id, {
        cascadeId: id,
        stepIndex,
      })) as {
        codeEditPreviews?: Array<{
          fileUri?: string;
          actionType?: string;
          diff?: {
            lines?: Array<{
              text?: string;
              type?: string;
            }>;
          };
        }>;
      };

      const files = (data.codeEditPreviews || [])
        .filter((item) => !item.fileUri?.includes("antigravity/brain"))
        .map((item) => {
          const uri = item.fileUri || "";
          const cleaned = uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
          const fileName = cleaned.split("/").pop() || cleaned;
          const ext = fileName.includes(".")
            ? fileName.split(".").pop()!.toLowerCase()
            : "";
          const lines = item.diff?.lines || [];
          const additions = lines.filter(
            (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT",
          ).length;
          const deletions = lines.filter(
            (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE",
          ).length;
          const isCreated = item.actionType === "CODE_REVERT_ACTION_TYPE_DELETE";
          return {
            fileUri: uri,
            fileName,
            ext,
            additions,
            deletions,
            isCreated,
          };
        });

      return c.json({ files });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations/:id/revert", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const body = await c.req.json();
        const metadata = await getMetadata(true);

        const req: Record<string, unknown> = {
          cascadeId: id,
          stepIndex: body.stepIndex,
          metadata,
        };

        const resolvedModel = await resolveModelIdentifier(body.model);
        req.overrideConfig = {
          plannerConfig: {
            plannerTypeConfig: { conversational: {} },
            requestedModel: { model: resolvedModel },
          },
        };

        const data = await rpcForConversation("RevertToCascadeStep", id, req);
        messageTracker.clearConversation(id);
        conversationSignals.emit("activate", id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Immediate Execution Mode / Project Permission Preset Sync ──
  app.post("/api/execution-mode", async (c) => {
    try {
      const body = await c.req.json();
      const { executionMode, conversationId, workspaceUri } = body;
      let targetWs = workspaceUri;
      let targetInstance: LSInstance | undefined;
      if (!targetWs && conversationId) {
        try {
          const { instance } = await getStepCount(conversationId);
          targetInstance = instance;
          const summary = (await rpc.call(
            "GetCascadeTrajectorySummary",
            { cascadeId: conversationId },
            instance,
          )) as Record<string, unknown>;
          targetWs = getPrimaryWorkspaceUri(summary);
        } catch {}
      }
      const instances = await discovery.getInstances();
      if (!targetInstance) {
        targetInstance = instances[0];
      }
      if (!targetWs) {
        targetWs = await discoverSingleWorkspaceUri(instances);
      }
      if (!targetWs) {
        targetWs = process.cwd();
      }

      let presetStr = "AGENT_PERMISSION_PRESET_DEFAULT";
      if (executionMode === "review_before_edit") {
        presetStr = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
      } else if (executionMode === "full_access") {
        presetStr = "AGENT_PERMISSION_PRESET_TURBO";
      } else if (executionMode === "planning") {
        presetStr = "AGENT_PERMISSION_PRESET_REQUEST_REVIEW";
      } else if (executionMode === "auto_edit") {
        presetStr = "AGENT_PERMISSION_PRESET_DEFAULT";
      }

      await syncProjectPermissionPreset(targetWs, presetStr, rpc, targetInstance);
      return c.json({ ok: true, preset: presetStr, workspaceUri: targetWs });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
