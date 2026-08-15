import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

export type NotificationSoundKind = "crystal" | "attention" | "complete";

interface ShowBrowserNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
  playSound?: boolean;
  soundKind?: NotificationSoundKind;
}

let sharedAudioCtx: AudioContext | null = null;

/**
 * Returns or initializes the shared AudioContext singleton.
 */
function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    try {
      sharedAudioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Unlock AudioContext on the first user interaction anywhere in the window.
 */
if (typeof window !== "undefined") {
  const unlockAudioContext = () => {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
  };

  window.addEventListener("pointerdown", unlockAudioContext, { passive: true });
  window.addEventListener("keydown", unlockAudioContext, { passive: true });
  window.addEventListener("touchstart", unlockAudioContext, { passive: true });
}

/**
 * Generate a pure fallback WAV audio element via data URI for environments
 * where Web Audio API is restricted or suspended.
 */
function playFallbackChime() {
  try {
    const sampleRate = 22050;
    const duration = 0.35;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Int16Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 9);
      const s1 = Math.sin(2 * Math.PI * 784 * t);
      const s2 = Math.sin(2 * Math.PI * 1046 * t) * 0.5;
      const sample = (s1 + s2) * env * 0.3 * 32767;
      buffer[i] = Math.max(-32768, Math.min(32767, sample));
    }

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const dataSize = numSamples * 2;

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    const blob = new Blob([header, buffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = 0.8;
    audio.play().catch(() => {});
    audio.onended = () => URL.revokeObjectURL(url);
  } catch {
    // Ignore autoplay restriction
  }
}

/**
 * Synthesize notes ONLY when AudioContext is actively running.
 * Never schedule nodes into a suspended context to avoid late bursts.
 */
function renderChimeNodes(ctx: AudioContext, kind: NotificationSoundKind) {
  if (ctx.state !== "running") return;
  const now = ctx.currentTime;

  const notes =
    kind === "attention"
      ? [
          { freq: 587.33, start: 0, duration: 0.22, gain: 0.28 }, // D5
          { freq: 880.0, start: 0.08, duration: 0.42, gain: 0.35 }, // A5
        ]
      : kind === "complete"
      ? [
          { freq: 659.25, start: 0, duration: 0.25, gain: 0.25 }, // E5
          { freq: 830.61, start: 0.07, duration: 0.32, gain: 0.28 }, // G#5
          { freq: 987.77, start: 0.14, duration: 0.42, gain: 0.32 }, // B5
          { freq: 1318.51, start: 0.21, duration: 0.55, gain: 0.3 }, // E6
        ]
      : [
          { freq: 523.25, start: 0, duration: 0.28, gain: 0.25 }, // C5
          { freq: 659.25, start: 0.07, duration: 0.32, gain: 0.28 }, // E5
          { freq: 783.99, start: 0.14, duration: 0.42, gain: 0.32 }, // G5
          { freq: 1046.5, start: 0.21, duration: 0.55, gain: 0.3 }, // C6
        ];

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.85, now);
  masterGain.connect(ctx.destination);

  notes.forEach(({ freq, start, duration, gain: peakGain }) => {
    const startTime = now + start;

    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    overtone.type = "triangle";

    osc.frequency.setValueAtTime(freq, startTime);
    overtone.frequency.setValueAtTime(freq * 2, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    overtone.connect(gain);
    gain.connect(masterGain);

    osc.start(startTime);
    overtone.start(startTime);

    osc.stop(startTime + duration);
    overtone.stop(startTime + duration);
  });
}

/**
 * Luxurious Apple / Glassmorphic Crystal Tech Chime
 * Blends pure sine waves with subtle harmonic overtones and smooth exponential gain envelope.
 */
export function playNotificationSound(kind: NotificationSoundKind = "crystal") {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) {
      playFallbackChime();
      return;
    }

    if (ctx.state === "running") {
      renderChimeNodes(ctx, kind);
    } else {
      ctx
        .resume()
        .then(() => {
          if (ctx.state === "running") {
            renderChimeNodes(ctx, kind);
          } else {
            playFallbackChime();
          }
        })
        .catch(() => {
          playFallbackChime();
        });
    }
  } catch {
    playFallbackChime();
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
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }

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
  soundKind = "crystal",
}: ShowBrowserNotificationOptions): boolean {
  if (playSound) {
    playNotificationSound(soundKind);
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
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.showNotification(title, {
            body,
            tag,
            icon: "/icons/icon-192.png",
          });
        })
        .catch(() => {});
      return true;
    }
    return false;
  }
}
