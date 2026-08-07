/**
 * Mobile Haptic Feedback Utility (触觉震动反馈)
 * Provides tactile feedback for native-like touch interactions on mobile devices.
 */

export type HapticType =
  | "light" // 10ms - subtle click (tab switch, button press)
  | "medium" // 25ms - standard feedback (drawer open, modal open, long-press)
  | "heavy" // 45ms - significant action (send, delete)
  | "success" // [12ms, 40ms, 18ms] - completed action (copied, message delivered)
  | "warning" // [30ms, 50ms, 30ms] - caution
  | "error"; // [40ms, 40ms, 40ms, 40ms] - failure

const PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 45,
  success: [12, 40, 18],
  warning: [30, 50, 30],
  error: [40, 40, 40, 40],
};

export function triggerHaptic(type: HapticType = "light"): boolean {
  if (typeof window === "undefined" || !navigator.vibrate) {
    return false;
  }
  try {
    const pattern = PATTERNS[type] || 10;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
