/**
 * Shared path utility functions.
 *
 * Centralised here to avoid duplication across hooks (previously
 * copy-pasted identically in useSubagentViewer.ts and usePlanTracker.ts).
 */

/**
 * Strips URI scheme, drive letter, and leading slashes from a path string,
 * normalising backslashes to forward slashes for cross-platform comparison.
 *
 * Examples:
 *   file:///C:/Users/foo/bar  ->  Users/foo/bar
 *   /home/user/project        ->  home/user/project
 *   C:\Users\foo              ->  Users/foo
 */
export function cleanPath(p?: string): string {
  if (!p) return "";
  return p
    .replace(/^file:\/\/\/?/, "")
    .replace(/^[a-zA-Z]:[\\/]/, "")
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/")
    .trim();
}
