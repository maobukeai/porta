import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../api/client";
import {
  workspaceNameFromMetadata,
  workspaceNameFromUri,
  safeDecodeUriComponent,
} from "../utils/workspaceNames";

/** Extract a short slug from a workspace URI: file:///home/user/work/porta → porta */
function slugFromUri(uri: string): string {
  return workspaceNameFromUri(uri);
}

/** Resolve a slug back to a full workspace URI using the workspace list. */
function uriFromSlug(
  slug: string,
  workspaces: { uri: string; name: string }[],
): string | undefined {
  if (!slug || workspaces.length === 0) return undefined;

  const decodedSlug = safeDecodeUriComponent(slug).toLowerCase();

  // 1. Direct match by workspace name or URI slug
  const directMatch = workspaces.find((w) => {
    const nameLower = safeDecodeUriComponent(w.name).toLowerCase();
    const uriSlugLower = safeDecodeUriComponent(workspaceNameFromUri(w.uri)).toLowerCase();
    return nameLower === decodedSlug || uriSlugLower === decodedSlug;
  });

  if (directMatch) return directMatch.uri;

  // 2. Partial / substring match
  const partialMatch = workspaces.find((w) => {
    const nameLower = safeDecodeUriComponent(w.name).toLowerCase();
    const uriSlugLower = safeDecodeUriComponent(workspaceNameFromUri(w.uri)).toLowerCase();
    return (
      nameLower.includes(decodedSlug) ||
      decodedSlug.includes(nameLower) ||
      uriSlugLower.includes(decodedSlug) ||
      decodedSlug.includes(uriSlugLower)
    );
  });

  if (partialMatch) return partialMatch.uri;

  // 3. Fallback to active workspace so user is never created in unassociated 'brain' folder
  return workspaces[0]?.uri;
}

interface ConversationEntry {
  id: string;
  summary: {
    lastModifiedTime?: string;
    workspaces?: {
      workspaceFolderAbsoluteUri?: string;
      repository?: { computedName?: string };
    }[];
  };
}

interface UseWorkspacesResult {
  workspaces: { uri: string; name: string }[];
  currentWorkspaceUri: string | undefined;
}

/**
 * Merge workspace sources: LS API + conversation metadata.
 * Returns a stable list of known workspaces and the resolved URI for the current URL slug.
 */
export function useWorkspaces(
  conversations: ConversationEntry[],
  projectSlug: string | undefined,
): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<{ uri: string; name: string }[]>(
    [],
  );
  const wsInitialized = useRef(false);

  useEffect(() => {
    // Collect from conversations and track their last modified time
    const fromConvs = new Map<string, string>();
    const workspaceRecency = new Map<string, number>();

    for (const conv of conversations) {
      const ws = conv.summary.workspaces?.[0];
      if (!ws?.workspaceFolderAbsoluteUri) continue;
      const uri = ws.workspaceFolderAbsoluteUri;
      const name = workspaceNameFromMetadata(ws);
      fromConvs.set(uri, name);

      const time = conv.summary.lastModifiedTime
        ? new Date(conv.summary.lastModifiedTime).getTime()
        : 0;
      const existing = workspaceRecency.get(uri) ?? 0;
      if (time > existing) {
        workspaceRecency.set(uri, time);
      }
    }

    // Collect from LS API
    api
      .getWorkspaces()
      .then((data) => {
        const fromApi = (data.workspaceInfos ?? []).map((w) => ({
          uri: w.workspaceUri,
          name: workspaceNameFromUri(w.workspaceUri),
        }));

        // Assign a high score (current time) to active workspaces that don't have past conversations
        // so that they stay at the very top of the list.
        for (const w of fromApi) {
          if (!workspaceRecency.has(w.uri)) {
            workspaceRecency.set(w.uri, Date.now());
          }
        }

        const merged = new Map<string, string>();
        for (const w of fromApi) merged.set(w.uri, w.name);
        for (const [uri, name] of fromConvs) {
          if (!merged.has(uri)) merged.set(uri, name);
        }

        const list = Array.from(merged, ([uri, name]) => ({ uri, name }));
        list.sort((a, b) => {
          const timeA = workspaceRecency.get(a.uri) ?? 0;
          const timeB = workspaceRecency.get(b.uri) ?? 0;
          return timeB - timeA;
        });

        setWorkspaces(list);
        wsInitialized.current = true;
      })
      .catch(() => {
        const list = Array.from(fromConvs, ([uri, name]) => ({ uri, name }));
        list.sort((a, b) => {
          const timeA = workspaceRecency.get(a.uri) ?? 0;
          const timeB = workspaceRecency.get(b.uri) ?? 0;
          return timeB - timeA;
        });
        setWorkspaces(list);
        wsInitialized.current = true;
      });
  }, [conversations]);

  const currentWorkspaceUri = useMemo(
    () => (projectSlug ? uriFromSlug(projectSlug, workspaces) : undefined),
    [projectSlug, workspaces],
  );

  return { workspaces, currentWorkspaceUri };
}

export { slugFromUri, uriFromSlug };
