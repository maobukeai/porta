import type { CapacitorConfig } from "@capacitor/cli";

// Enable WebView debugging only in development / explicit debug builds.
// NEVER enable this in production APKs — it allows any attacker with USB access
// (or Chrome DevTools) to inspect and manipulate the WebView at will.
const isDebugBuild =
  process.env.CAPACITOR_DEBUG === "true" ||
  process.env.NODE_ENV === "development";

const config: CapacitorConfig = {
  appId: "com.porta.app",
  appName: "Porta",
  webDir: "dist",
  server: {
    androidScheme: "http",
    cleartext: true,
    allowNavigation: ["*"],
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: isDebugBuild,
  },
};

export default config;
