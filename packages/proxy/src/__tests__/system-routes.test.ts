import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerSystemRoutes } from "../routes/system.js";
import {
  deriveIdePathFromLsPath,
  splitArgs,
} from "../antigravity-launch.js";

vi.mock("../routing.js", () => ({
  discovery: {
    getInstances: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../platform/index.js", () => ({
  platformAdapter: {
    findProcessPidsByName: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../antigravity-launch.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../antigravity-launch.js")>();
  return {
    ...actual,
    resolveIdePath: vi.fn().mockReturnValue({ path: null, source: "none" }),
    resolveLaunchPlan: vi.fn().mockImplementation(() => {
      throw new Error("no plan");
    }),
    launchAntigravity: vi.fn().mockReturnValue({
      method: "bat",
      command: "fake.bat",
    }),
  };
});

import { discovery } from "../routing.js";
import { platformAdapter } from "../platform/index.js";
import { launchAntigravity } from "../antigravity-launch.js";

const mockedDiscovery = vi.mocked(discovery);
const mockedAdapter = vi.mocked(platformAdapter);
const mockedLaunch = vi.mocked(launchAntigravity);

function createApp() {
  const app = new Hono();
  registerSystemRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDiscovery.getInstances.mockResolvedValue([]);
  mockedAdapter.findProcessPidsByName.mockResolvedValue([]);
});

describe("deriveIdePathFromLsPath", () => {
  it("derives the IDE root from the resources/bin layout", () => {
    const path = deriveIdePathFromLsPath(
      "C:\\Users\\me\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe",
    );
    expect(path).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
    );
  });

  it("falls back to walking up two directories", () => {
    const isWin = process.platform === "win32";
    const path = deriveIdePathFromLsPath(
      isWin ? "C:\\opt\\antigravity\\bin\\language_server.exe" : "/opt/antigravity/bin/language_server",
    );
    expect(path).toBe(
      isWin ? "C:\\opt\\antigravity\\Antigravity.exe" : "/opt/antigravity/antigravity",
    );
  });
});

describe("splitArgs", () => {
  it("splits on whitespace and honors quotes", () => {
    expect(splitArgs('--proxy-server=http://127.0.0.1:7890 --flag "a b"')).toEqual([
      "--proxy-server=http://127.0.0.1:7890",
      "--flag",
      "a b",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitArgs("   ")).toEqual([]);
  });
});

describe("GET /api/system/diagnostics", () => {
  it("reports an unreachable state when nothing is running", async () => {
    const res = await createApp().request("/api/system/diagnostics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.languageServers).toEqual([]);
    expect(body.antigravity.processRunning).toBe(false);
    expect(body.antigravity.launchable).toBe(false);
  });

  it("reports running LS instances and IDE processes", async () => {
    mockedDiscovery.getInstances.mockResolvedValue([
      {
        pid: 123,
        httpsPort: 456,
        httpPort: 0,
        lspPort: 0,
        csrfToken: "t",
        workspaceId: "ws",
        source: "process",
      },
    ]);
    mockedAdapter.findProcessPidsByName.mockResolvedValue([999]);

    const res = await createApp().request("/api/system/diagnostics");
    const body = await res.json();
    expect(body.languageServers).toHaveLength(1);
    expect(body.languageServers[0].pid).toBe(123);
    expect(body.antigravity.processRunning).toBe(true);
    expect(body.antigravity.pids).toEqual([999]);
  });
});

describe("POST /api/system/antigravity/launch", () => {
  it("refuses when the Language Server is already running", async () => {
    mockedDiscovery.getInstances.mockResolvedValue([
      {
        pid: 123,
        httpsPort: 456,
        httpPort: 0,
        lspPort: 0,
        csrfToken: "t",
        source: "process",
      },
    ]);
    const res = await createApp().request("/api/system/antigravity/launch", {
      method: "POST",
    });
    const body = await res.json();
    expect(body.started).toBe(false);
    expect(body.reason).toBe("language-server-already-running");
    expect(mockedLaunch).not.toHaveBeenCalled();
  });

  it("launches and reports the command", async () => {
    const res = await createApp().request("/api/system/antigravity/launch", {
      method: "POST",
    });
    const body = await res.json();
    expect(body.started).toBe(true);
    expect(body.method).toBe("bat");
    expect(mockedLaunch).toHaveBeenCalledTimes(1);
  });

  it("returns 400 with a hint when no launch method is available", async () => {
    mockedLaunch.mockImplementationOnce(() => {
      throw new Error("Cannot determine how to launch Antigravity");
    });
    const res = await createApp().request("/api/system/antigravity/launch", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot determine");
    expect(body.hint).toContain("PORTA_ANTIGRAVITY_LAUNCH_BAT");
  });
});
