import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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

// ── Discover Tailscale Executable & IP ──

function getTailscaleExe() {
  const possiblePaths = [
    "tailscale",
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
    path.join(process.env.LOCALAPPDATA || "", "Tailscale", "tailscale.exe"),
  ];

  for (const exe of possiblePaths) {
    if (exe === "tailscale") continue;
    if (existsSync(exe)) return exe;
  }
  return "tailscale";
}

const tailscaleExe = getTailscaleExe();
let tailscaleIp;

try {
  tailscaleIp = execFileSync(tailscaleExe, ["ip", "-4"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)[0]
    .trim();
} catch {
  console.log("\n============================================================");
  console.log("  ⚠️  未检测到 Tailscale 客户端或未登录连接");
  console.log("============================================================");
  console.log("  如需使用 Tailscale 异地组网高速远程：");
  console.log("  1. 电脑端下载并安装: https://tailscale.com/download/windows");
  console.log("  2. 安装后打开并登录您的账号 (支持微软/谷歌/GitHub账号)");
  console.log("  3. 手机端在应用商店下载 Tailscale App 并登录同一账号");
  console.log("  4. 重新运行本脚本即可生成专属极速远程链接 (10~30ms延迟)\n");
  console.log("  💡 如果您现在在家里/办公室，推荐直接使用「局域网直连」模式。");
  console.log("============================================================\n");
  process.exit(1);
}

if (!tailscaleIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(tailscaleIp)) {
  console.error(
    `\n⚠️ Tailscale 返回的 IP 异常: "${tailscaleIp}"。请确保 Tailscale 客户端已连接并分配了有效的 100.x.x.x IP。\n`,
  );
  process.exit(1);
}

const webPort = process.env.PORTA_WEB_PORT || "3070";
const proxyPort = process.env.PORTA_PORT || "3170";

// Ensure ports are freed from previous aborted sessions
freePort(webPort);
freePort(proxyPort);

// ── Inject into env ──
process.env.PORTA_HOST = tailscaleIp;
process.env.PORTA_TAILSCALE = "1";

const tailscaleOrigin = `http://${tailscaleIp}:${webPort}`;
if (process.env.PORTA_CORS_ORIGINS) {
  process.env.PORTA_CORS_ORIGINS += `,${tailscaleOrigin}`;
} else {
  process.env.PORTA_CORS_ORIGINS = tailscaleOrigin;
}

// ── Spawn processes ──

const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "dev"],
    path.join(logsDir, "proxy.log"),
    { env: process.env },
  ),
  spawnLoggedProcess(
    "web",
    commandName("pnpm"),
    ["--filter", "@porta/web", "dev", "--host", "--port", webPort],
    path.join(logsDir, "web.log"),
    {
      env: {
        ...process.env,
        VITE_API_BASE: `http://${tailscaleIp}:${proxyPort}`,
      },
    },
  ),
];

console.log("\n============================================================");
console.log("  🚀 Porta 正在运行 (Tailscale 异地组网远程模式)");
console.log("============================================================");
console.log(`  📱 手机远程访问:    http://${tailscaleIp}:${webPort}`);
console.log(`  💻 本地电脑访问:    http://localhost:${webPort}`);
console.log(`  🔗 Tailscale IP:   ${tailscaleIp}`);
console.log("============================================================");
console.log("  💡 提示: 只要手机也连接了同一 Tailscale 账号，即可随时随地极速控制。");
console.log("  📄 日志已输出至: logs/proxy.log 与 logs/web.log\n");

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.all(runners.map(({ child }) => terminateChild(child)));
  await Promise.all(
    runners.map(
      ({ logStream }) =>
        new Promise((resolve) => {
          logStream.end(resolve);
        }),
    ),
  );
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
  const label = firstExit.index === 0 ? "proxy" : "web";
  const code = typeof firstExit.code === "number" ? firstExit.code : 1;
  console.error(`${label} exited early`);
  await shutdown(code);
}
