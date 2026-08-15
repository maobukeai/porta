import path from "node:path";
import {
  commandName,
  ensureLogsDir,
  freePort,
  getLocalLanIps,
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

const lanIps = getLocalLanIps();
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
];

console.log("\n============================================================");
console.log("  🚀 Porta 正在运行 (局域网 + 本机直连模式)");
console.log("============================================================");
console.log(`  💻 电脑本机访问:    http://localhost:${webPort}`);
if (lanIps.length > 0) {
  for (const ip of lanIps) {
    console.log(`  📱 手机局域网访问:  http://${ip}:${webPort}`);
  }
} else {
  console.log(`  📱 手机局域网访问:  http://<电脑局域网IP>:${webPort}`);
}
console.log("============================================================");
console.log("  💡 提示: 手机与电脑连接同一 Wi-Fi 即可秒开体验低延迟控制。");
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
