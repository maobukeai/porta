/**
 * Quota and User Status caching utility
 * Persists recent quota values in localStorage so modals and drawers
 * open immediately with the real cached values instead of defaulting to 100%.
 */

const QUOTA_CACHE_KEY = "porta_cached_quota_summary";
const USER_STATUS_CACHE_KEY = "porta_cached_user_status";

let inMemoryQuota: any = null;
let inMemoryStatus: any = null;

export function getCachedQuotaSummary(): any | null {
  if (inMemoryQuota) return inMemoryQuota;
  try {
    const raw = localStorage.getItem(QUOTA_CACHE_KEY);
    if (raw) {
      inMemoryQuota = JSON.parse(raw);
      return inMemoryQuota;
    }
  } catch {}
  return null;
}

export function setCachedQuotaSummary(summary: any) {
  if (!summary) return;
  inMemoryQuota = summary;
  try {
    localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(summary));
  } catch {}
}

export function getCachedUserStatus(): any | null {
  if (inMemoryStatus) return inMemoryStatus;
  try {
    const raw = localStorage.getItem(USER_STATUS_CACHE_KEY);
    if (raw) {
      inMemoryStatus = JSON.parse(raw);
      return inMemoryStatus;
    }
  } catch {}
  return null;
}

export function setCachedUserStatus(status: any) {
  if (!status) return;
  inMemoryStatus = status;
  try {
    localStorage.setItem(USER_STATUS_CACHE_KEY, JSON.stringify(status));
  } catch {}
}
