import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QuotaAlertCard } from "../components/QuotaAlertCard";

describe("QuotaAlertCard", () => {
  const sampleError =
    "Baseline model quota reached. Your plan's baseline quota will refresh on 2026/8/14 17:57:47. You can upgrade to a Google AI Ultra plan to receive higher rate limits. See plans.";

  it("renders baseline quota reached card in Chinese with refresh time and action buttons", () => {
    render(<QuotaAlertCard content={sampleError} />);

    expect(screen.getByText("基准模型配额已达上限")).toBeDefined();
    expect(screen.getByText(/2026\/8\/14 17:57:47/)).toBeDefined();
    expect(screen.getByText("忽略")).toBeDefined();
    expect(screen.getAllByText("查看方案").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("开启超额配额")).toBeDefined();
  });

  it("dispatches antigravity:open-quota event when '查看方案' or '开启超额配额' is clicked", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<QuotaAlertCard content={sampleError} />);

    const seePlansBtns = screen.getAllByText("查看方案");
    fireEvent.click(seePlansBtns[0]);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "antigravity:open-quota" }),
    );

    const enableOveragesBtn = screen.getByText("开启超额配额");
    fireEvent.click(enableOveragesBtn);

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    dispatchSpy.mockRestore();
  });

  it("dismisses the card when '忽略' is clicked", () => {
    render(<QuotaAlertCard content={sampleError} />);

    expect(screen.getByText("基准模型配额已达上限")).toBeDefined();

    const dismissBtn = screen.getByText("忽略");
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("基准模型配额已达上限")).toBeNull();
  });

  it("toggles raw error details when '展开详细日志' is clicked for quota errors", () => {
    render(<QuotaAlertCard content={sampleError} />);

    const rawToggleBtn = screen.getByText("展开详细日志");
    fireEvent.click(rawToggleBtn);

    expect(screen.getByText("收起详细日志")).toBeDefined();
    expect(screen.getByText(sampleError)).toBeDefined();
  });

  it("renders generic error directly outside on the card", () => {
    render(<QuotaAlertCard content="API 500: Internal server error" />);

    expect(screen.getByText("❌ 执行中断或发送失败")).toBeDefined();
    expect(screen.getByText("API 500: Internal server error")).toBeDefined();
    expect(screen.getByText("忽略")).toBeDefined();
    expect(screen.queryByText("开启超额配额")).toBeNull();
  });

  it("unpacks complex JSON tool error payload and keeps main UI clean", () => {
    const jsonError = JSON.stringify({
      error: {
        userErrorMessage: "The model produced an invalid tool call.",
        modelErrorMessage: "There was a problem parsing the tool call.\n(1) stack trace:\ngoogle3/tools...",
      },
    });

    render(<QuotaAlertCard content={jsonError} />);

    expect(screen.getByText("❌ 执行中断或发送失败")).toBeDefined();
    expect(screen.getByText("The model produced an invalid tool call.")).toBeDefined();
    expect(screen.queryByText(/google3\/tools/)).toBeNull(); // Clean summary hides raw stack trace
    expect(screen.getByText("展开详细日志")).toBeDefined();
  });

  it("automatically fades out and dismisses when card transitions to historical (user sends new message)", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<QuotaAlertCard content={sampleError} isHistorical={false} />);
    expect(screen.getByText("基准模型配额已达上限")).toBeDefined();

    // When user sends a new message, isHistorical becomes true
    rerender(<QuotaAlertCard content={sampleError} isHistorical={true} />);

    // Fast-forward fade-out animation timer (350ms)
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByText("基准模型配额已达上限")).toBeNull();
    vi.useRealTimers();
  });

  it("automatically fades out and dismisses when quota refresh time arrives", async () => {
    vi.useFakeTimers();
    const futureTime = new Date(Date.now() + 5000).toISOString();
    const errorWithFutureTime = `Baseline model quota reached. Your plan's baseline quota will refresh on ${futureTime}.`;

    render(<QuotaAlertCard content={errorWithFutureTime} isHistorical={false} />);
    expect(screen.getByText("基准模型配额已达上限")).toBeDefined();

    // Advance to the refresh time + fade-out duration
    act(() => {
      vi.advanceTimersByTime(5000 + 400);
    });

    expect(screen.queryByText("基准模型配额已达上限")).toBeNull();
    vi.useRealTimers();
  });
});
