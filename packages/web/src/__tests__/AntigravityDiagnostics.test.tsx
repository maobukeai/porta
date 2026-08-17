import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AntigravityDiagnostics } from "../components/AntigravityDiagnostics";
import type { SystemDiagnostics } from "../types";

const systemDiagnosticsMock = vi.fn();
const launchAntigravityMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    systemDiagnostics: (...args: unknown[]) => systemDiagnosticsMock(...args),
    launchAntigravity: (...args: unknown[]) => launchAntigravityMock(...args),
  },
}));

function makeDiagnostics(
  overrides: Partial<SystemDiagnostics> = {},
): SystemDiagnostics {
  return {
    proxy: { port: 3170, uptime: 10 },
    languageServers: [],
    antigravity: {
      processRunning: false,
      pids: [],
      idePath: "C:\\Antigravity\\Antigravity.exe",
      idePathSource: "default",
      launchable: true,
      launchMethod: "bat",
      batPath: "C:\\启动Antigravity_使用代理.bat",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AntigravityDiagnostics", () => {
  it("renders diagnostic rows for an offline state", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(await screen.findByText("无法连接 Antigravity")).toBeTruthy();
    expect(screen.getByText("Antigravity 桌面端")).toBeTruthy();
    expect(screen.getByText("未运行")).toBeTruthy();
    expect(screen.getByText(/启动脚本/)).toBeTruthy();
  });

  it("enables the relaunch button when a launch method is configured", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={vi.fn()} />,
    );

    const btn = await screen.findByRole("button", {
      name: "重新打开 Antigravity",
    });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the relaunch button when no launch method is available", async () => {
    systemDiagnosticsMock.mockResolvedValue(
      makeDiagnostics({
        antigravity: {
          processRunning: false,
          pids: [],
          idePath: null,
          idePathSource: "none",
          launchable: false,
          launchMethod: null,
          batPath: null,
        },
      }),
    );
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={vi.fn()} />,
    );

    const btn = await screen.findByRole("button", {
      name: "重新打开 Antigravity",
    });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls launch API and switches to waiting state", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    launchAntigravityMock.mockResolvedValue({
      started: true,
      method: "bat",
      command: "fake.bat",
    });
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={vi.fn()} />,
    );

    const btn = await screen.findByRole("button", {
      name: "重新打开 Antigravity",
    });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(launchAntigravityMock).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/等待 Language Server 上线/),
    ).toBeTruthy();
  });

  it("shows a launch error when the API rejects", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    launchAntigravityMock.mockRejectedValue(
      new Error("Cannot determine how to launch Antigravity"),
    );
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={vi.fn()} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "重新打开 Antigravity" }),
    );

    expect(
      await screen.findByText(/启动失败：Cannot determine/),
    ).toBeTruthy();
  });

  it("auto-triggers onRecovered when diagnostics sees the LS back online", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    const onRecovered = vi.fn();
    render(
      <AntigravityDiagnostics onRecovered={onRecovered} onDismiss={vi.fn()} />,
    );

    await screen.findByText("无法连接 Antigravity");
    expect(onRecovered).not.toHaveBeenCalled();

    // Next diagnostics run (poll or 重新诊断) sees a live LS
    systemDiagnosticsMock.mockResolvedValue(
      makeDiagnostics({
        languageServers: [
          { pid: 1, httpsPort: 2, workspaceId: "ws", source: "process" },
        ],
        antigravity: {
          processRunning: true,
          pids: [99],
          idePath: "C:\\Antigravity\\Antigravity.exe",
          idePathSource: "default",
          launchable: true,
          launchMethod: "bat",
          batPath: "C:\\启动.bat",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));

    await waitFor(() => {
      expect(onRecovered).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onDismiss when the user chooses to browse history", async () => {
    systemDiagnosticsMock.mockResolvedValue(makeDiagnostics());
    const onDismiss = vi.fn();
    render(
      <AntigravityDiagnostics onRecovered={vi.fn()} onDismiss={onDismiss} />,
    );

    fireEvent.click(await screen.findByText(/暂不处理，浏览历史会话/));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
