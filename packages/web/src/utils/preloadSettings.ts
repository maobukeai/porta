/**
 * Utility for silent background preloading of heavy modules
 */

let settingsPanelPreloaded = false;

export function preloadSettingsPanel(): Promise<unknown> | void {
  if (settingsPanelPreloaded) return;
  settingsPanelPreloaded = true;
  return import("../components/SettingsPanel").catch((err) => {
    settingsPanelPreloaded = false;
    console.warn("[Preload] Failed to preload SettingsPanel:", err);
  });
}
