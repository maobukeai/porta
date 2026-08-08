import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

interface ShowBrowserNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
  playSound?: boolean;
}

/**
 * Luxurious Apple / Glassmorphic Crystal Tech Chime (3-note arpeggio)
 * C5 (523.25Hz) -> E5 (659.25Hz) -> G5 (783.99Hz)
 * Blends pure sine waves with subtle triangle octave overtones and smooth gain envelope.
 */
export function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const notes = [
      { freq: 523.25, start: 0, duration: 0.28 },
      { freq: 659.25, start: 0.07, duration: 0.3 },
      { freq: 783.99, start: 0.14, duration: 0.42 },
    ];

    notes.forEach(({ freq, start, duration }) => {
      const startTime = now + start;

      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      overtone.type = "triangle";

      osc.frequency.setValueAtTime(freq, startTime);
      overtone.frequency.setValueAtTime(freq * 2, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      overtone.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      overtone.start(startTime);

      osc.stop(startTime + duration);
      overtone.stop(startTime + duration);
    });
  } catch {
    // Ignore autoplay limits
  }
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (Capacitor.isNativePlatform()) {
    return "granted";
  }

  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.requestPermissions();
      if (status.display === "granted") return "granted";
    } catch (err) {
      console.warn("Capacitor LocalNotifications error:", err);
    }
  }

  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  return window.Notification.requestPermission();
}

export function shouldShowBrowserNotification(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof document === "undefined") return true;

  if (document.hidden) return true;
  if (typeof document.hasFocus === "function") {
    return !document.hasFocus();
  }

  return false;
}

export function showBrowserNotification({
  title,
  body,
  tag,
  playSound = true,
}: ShowBrowserNotificationOptions): boolean {
  if (playSound) {
    playNotificationSound();
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const id = Math.floor(Math.random() * 100000);
      LocalNotifications.schedule({
        notifications: [
          {
            title,
            body: body ?? "",
            id,
            schedule: { at: new Date(Date.now() + 100) },
            sound: undefined,
            actionTypeId: "",
            extra: null,
          },
        ],
      });
      return true;
    } catch (err) {
      console.warn("Native notification trigger error:", err);
    }
  }

  if (getBrowserNotificationPermission() !== "granted") return false;
  if (!shouldShowBrowserNotification()) return false;

  try {
    const notification = new window.Notification(title, {
      body,
      tag,
      icon: "/icons/icon-192.png",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    window.setTimeout(() => notification.close(), 10_000);
    return true;
  } catch {
    return false;
  }
}
