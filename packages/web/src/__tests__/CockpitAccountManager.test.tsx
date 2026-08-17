import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CockpitAccountManager } from "../components/CockpitAccountManager";
import type { CockpitAccount, CockpitStatus } from "../types";
const cockpitStatusMock = vi.fn();
const cockpitAccountsMock = vi.fn();
const cockpitSwitchAccountMock = vi.fn();
const cockpitRefreshQuotaMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    cockpitStatus: () => cockpitStatusMock(),
    cockpitAccounts: () => cockpitAccountsMock(),
    cockpitSwitchAccount: (id: string) => cockpitSwitchAccountMock(id),
    cockpitRefreshQuota: (id: string) => cockpitRefreshQuotaMock(id),
  },
}));

const connectedStatus: CockpitStatus = {
  connected: true,
  version: "1.3.21",
  wsPort: 19528,
};

function makeAccount(overrides: Partial<CockpitAccount> = {}): CockpitAccount {
  return {
    id: "a1",
    email: "one@gmail.com",
    name: "One",
    is_current: true,
    disabled: false,
    last_used: 0,
    subscription_tier: "pro",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cockpitStatusMock.mockResolvedValue(connectedStatus);
  cockpitAccountsMock.mockResolvedValue({ accounts: [], currentAccountId: null });
});
describe("CockpitAccountManager", () => {
  it("shows the disconnected state with the reason when cockpit is absent", async () => {
    cockpitStatusMock.mockResolvedValue({
      connected: false,
      code: "not_installed",
      error: "cockpit-tools 未安装",
    });
    render(<CockpitAccountManager />);

    expect(await screen.findByText("● 未连接")).toBeTruthy();
    const statusText = document.querySelector(".cockpit-status-text");
    expect(statusText?.textContent).toContain("cockpit-tools 未安装");
    expect(statusText?.textContent).toContain("需安装并运行 cockpit-tools");
    expect(screen.queryByText("one@gmail.com")).toBeNull();
  });

  it("lists accounts and marks the current one", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [
        makeAccount(),
        makeAccount({
          id: "a2",
          email: "two@gmail.com",
          is_current: false,
        }),
      ],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    expect(await screen.findByText("one@gmail.com")).toBeTruthy();
    expect(screen.getByText("two@gmail.com")).toBeTruthy();
    expect(screen.getByText(/当前/)).toBeTruthy();
    const currentRow = screen
      .getByText("one@gmail.com")
      .closest(".cockpit-account-row");
    expect(
      currentRow?.querySelector(".cockpit-account-meta")?.textContent,
    ).toContain("Pro");
  });

  it("asks for confirmation before switching and dispatches the switch lifecycle", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount(), makeAccount({ id: "a2", email: "two@gmail.com", is_current: false })],
      currentAccountId: "a1",
    });
    cockpitSwitchAccountMock.mockResolvedValue({ ok: true, message: "切换账号成功" });
    const switchEvent = vi.fn();
    window.addEventListener("porta:cockpit-switch", switchEvent);

    render(<CockpitAccountManager />);
    fireEvent.click(await screen.findByText("two@gmail.com"));

    // Modal pops up directly with the target account
    const modal = document.querySelector(".cockpit-switch-modal");
    expect(modal).toBeTruthy();
    expect(modal?.textContent).toContain("切换账号");
    expect(modal?.textContent).toContain("two@gmail.com");
    expect(cockpitSwitchAccountMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));

    await waitFor(() => {
      expect(cockpitSwitchAccountMock).toHaveBeenCalledWith("a2");
    });
    // switch lifecycle event: active true then false
    await waitFor(() => {
      expect(switchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { active: true } }),
      );
      expect(switchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { active: false } }),
      );
    });
    expect(await screen.findByText(/切换账号成功/)).toBeTruthy();
    window.removeEventListener("porta:cockpit-switch", switchEvent);
  });

  it("closes the modal without switching when cancelled", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount(), makeAccount({ id: "a2", email: "two@gmail.com", is_current: false })],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    fireEvent.click(await screen.findByText("two@gmail.com"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(document.querySelector(".cockpit-switch-modal")).toBeNull();
    expect(cockpitSwitchAccountMock).not.toHaveBeenCalled();
  });

  it("shows the cockpit error message on switch failure", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount(), makeAccount({ id: "a2", email: "two@gmail.com", is_current: false })],
      currentAccountId: "a1",
    });
    cockpitSwitchAccountMock.mockRejectedValue(
      new Error("账号已被禁用"),
    );
    render(<CockpitAccountManager />);

    fireEvent.click(await screen.findByText("two@gmail.com"));
    fireEvent.click(await screen.findByRole("button", { name: "确认切换" }));

    expect(await screen.findByText(/切换失败：账号已被禁用/)).toBeTruthy();
  });

  it("does not allow switching to the current or disabled account", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [
        makeAccount(),
        makeAccount({
          id: "a3",
          email: "three@gmail.com",
          is_current: false,
          disabled: true,
        }),
      ],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    await screen.findByText("one@gmail.com");
    const currentRow = screen.getByText("one@gmail.com").closest(".cockpit-account-row");
    expect(currentRow?.getAttribute("role")).toBeNull();
    const disabledRow = screen.getByText("three@gmail.com").closest(".cockpit-account-row");
    expect(disabledRow?.getAttribute("role")).toBeNull();
    expect(screen.getByText(/已禁用/)).toBeTruthy();
  });

  it("shows quota chips (most-constrained models first) and the snapshot age", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [
        makeAccount({
          quota: {
            updatedAt: Date.now() - 5 * 60_000,
            models: [
              { name: "Gemini 3.1 Flash", remainingPercent: 95 },
              { name: "Claude Opus 4.6", remainingPercent: 42 },
              { name: "Claude Sonnet 4.6", remainingPercent: 10 },
              { name: "Grok 4", remainingPercent: 77 },
            ],
          },
        }),
      ],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    await screen.findByText("one@gmail.com");
    const chips = document.querySelectorAll(".cockpit-quota-chip");
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toContain("Claude Sonnet 4.6 10%");
    expect(chips[0].className).toContain("is-low");
    expect(chips[1].textContent).toContain("Claude Opus 4.6 42%");
    expect(chips[2].textContent).toContain("Grok 4 77%");
    expect(screen.getByText(/额度更新于 5 分钟前/)).toBeTruthy();
  });

  it("prefers group quota (weekly/5h) over per-model chips when available", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [
        makeAccount({
          quota: {
            updatedAt: Date.now(),
            models: [{ name: "Gemini 3.1 Flash", remainingPercent: 100 }],
            groups: [
              {
                name: "Gemini Models",
                buckets: [
                  { window: "weekly", remainingPercent: 77, resetTime: "2026-08-23T14:54:51Z" },
                  { window: "5h", remainingPercent: 100 },
                ],
              },
              {
                name: "Claude and GPT models",
                buckets: [
                  { window: "weekly", remainingPercent: 30 },
                  { window: "5h", remainingPercent: 90 },
                ],
              },
            ],
          },
        }),
      ],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    await screen.findByText("one@gmail.com");
    const chips = document.querySelectorAll(".cockpit-quota-chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe("Gemini 周77% · 5时100%");
    expect(chips[0].className).toContain("is-ok");
    expect(chips[1].textContent).toBe("Claude/GPT 周30% · 5时90%");
    expect(chips[1].className).toContain("is-warn");
    // Per-model chips must NOT be shown when groups exist
    expect(screen.queryByText(/Gemini 3.1 Flash/)).toBeNull();
  });

  it("shows a placeholder when an account has no quota snapshot", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount({ quota: null })],
      currentAccountId: "a1",
    });
    render(<CockpitAccountManager />);

    expect(await screen.findByText("one@gmail.com")).toBeTruthy();
    expect(screen.getByText("暂无额度数据")).toBeTruthy();
  });

  it("refreshes a single account's quota live via the row button", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount({ quota: null })],
      currentAccountId: "a1",
    });
    cockpitRefreshQuotaMock.mockResolvedValue({
      ok: true,
      email: "one@gmail.com",
      quota: {
        updatedAt: Date.now(),
        models: [
          { name: "Claude Opus 4.6", remainingPercent: 30, resetTime: "2026-08-20" },
        ],
      },
    });
    render(<CockpitAccountManager />);

    expect(await screen.findByText("暂无额度数据")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /实时刷新此账号额度/ }),
    );

    await waitFor(() => {
      expect(cockpitRefreshQuotaMock).toHaveBeenCalledWith("a1");
    });
    expect(await screen.findByText("Claude Opus 4.6 30%")).toBeTruthy();
    expect(screen.queryByText("暂无额度数据")).toBeNull();
  });

  it("shows a per-row error when the quota refresh fails", async () => {
    cockpitAccountsMock.mockResolvedValue({
      accounts: [makeAccount({ quota: null })],
      currentAccountId: "a1",
    });
    cockpitRefreshQuotaMock.mockRejectedValue(
      new Error("访问令牌已过期或无效，请在电脑端 cockpit-tools 中刷新该账号后重试"),
    );
    render(<CockpitAccountManager />);

    expect(await screen.findByText("暂无额度数据")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /实时刷新此账号额度/ }),
    );

    expect(
      await screen.findByText(/访问令牌已过期或无效/),
    ).toBeTruthy();
  });
});
