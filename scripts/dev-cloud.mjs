import { existsSync } from "node:fs";
import path from "node:path";
import {
  commandName,
  ensureLogsDir,
  freePort,
  loadEnvFile,
  spawnLoggedProcess,
  terminateChild,
  waitForExit,
} from "./common.mjs";

loadEnvFile();

const webPort = process.env.PORTA_WEB_PORT || "3070";
const proxyPort = process.env.PORTA_PORT || "3170";

// Ensure ports are freed from previous aborted sessions
freePort(webPort);
freePort(proxyPort);

const tunnelName = process.env.PORTA_TUNNEL_NAME;
if (!tunnelName) {
  console.error("PORTA_TUNNEL_NAME is required in .env or the environment");
  process.exit(1);
}
const cloudflaredConfig = process.env.PORTA_CLOUDFLARED_CONFIG;
const tunnelProtocol = process.env.PORTA_TUNNEL_PROTOCOL || "http2";
const cloudflaredArgs = [
  ...(cloudflaredConfig ? ["--config", cloudflaredConfig] : []),
  "tunnel",
  ...(tunnelProtocol ? ["--protocol", tunnelProtocol] : []),
  "run",
  tunnelName,
];

const localCloudflared = path.resolve("cloudflared.exe");
const useLocalBinary = existsSync(localCloudflared);
const tunnelCommand = useLocalBinary ? `"${localCloudflared}"` : commandName("npx");
const tunnelExecArgs = useLocalBinary ? cloudflaredArgs : ["cloudflared", ...cloudflaredArgs];

const runnerLabels = ["proxy", "web", "tunnel"];
const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "dev"],
    path.join(logsDir, "proxy.log"),
  ),
  spawnLoggedProcess(
    "web",
    commandName("pnpm"),
    ["--filter", "@porta/web", "dev"],
    path.join(logsDir, "web.log"),
  ),
  spawnLoggedProcess(
    "tunnel",
    tunnelCommand,
    tunnelExecArgs,
    path.join(logsDir, "tunnel.log"),
  ),
];

console.log("✓ Porta cloud - tail logs/proxy.log and logs/tunnel.log");

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.all(runners.map(({ child }) => terminateChild(child)));
  await Promise.all(runners.map(({ logStream }) => new Promise((resolve) => {
    logStream.end(resolve);
  })));
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

const exits = runners.map(async ({ child }, index) => ({
  index,
  ...(await waitForExit(child)),
}));

const firstExit = await Promise.race(exits);
if (!shuttingDown) {
  const label = runnerLabels[firstExit.index] || "process";
  const code = typeof firstExit.code === "number" ? firstExit.code : 1;
  console.error(`${label} exited early`);
  await shutdown(code);
}

