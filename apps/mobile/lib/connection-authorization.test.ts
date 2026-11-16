import { afterEach, describe, expect, it, vi } from "vitest";
import { finishConnectionAuthorization } from "./connection-authorization";

afterEach(() => vi.useRealTimers());
const started = {
  authorizationId: "workflow-1",
  connectionId: "connection-1",
  authorizationUrl: "https://signin.example.test",
};
function options() {
  return {
    signal: new AbortController().signal,
    openUrl: vi.fn(async () => undefined),
    confirmCode: vi.fn(async () => true),
    complete: vi.fn(async () => ({ status: "connected" })),
  };
}

describe("native connection authorization", () => {
  it("opens the system sign-in and checks the saved connection instead of assuming success", async () => {
    const flow = options();
    await expect(finishConnectionAuthorization(started, flow)).resolves.toBe(true);
    expect(flow.openUrl).toHaveBeenCalledWith(started.authorizationUrl);
    expect(flow.complete).toHaveBeenCalledWith("connection-1", "workflow-1");
  });
  it("shows a returned code before opening its verification URI", async () => {
    const flow = options();
    await finishConnectionAuthorization(
      { ...started, userCode: "ABCD-EFGH", verificationUri: "https://device.example.test" },
      flow,
    );
    expect(flow.confirmCode).toHaveBeenCalledWith("ABCD-EFGH");
    expect(flow.openUrl).toHaveBeenCalledWith("https://device.example.test");
    expect(flow.confirmCode.mock.invocationCallOrder[0]).toBeLessThan(
      flow.openUrl.mock.invocationCallOrder[0]!,
    );
  });
  it("does not open a browser or poll after the user cancels a device code", async () => {
    const flow = options();
    flow.confirmCode.mockResolvedValue(false);
    await expect(
      finishConnectionAuthorization({ ...started, userCode: "ABCD-EFGH" }, flow),
    ).resolves.toBe(null);
    expect(flow.openUrl).not.toHaveBeenCalled();
    expect(flow.complete).not.toHaveBeenCalled();
  });
  it("polls until connection is confirmed and stops on cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const flow = options();
    flow.signal = controller.signal;
    flow.complete.mockResolvedValue({ status: "pending" });
    const result = finishConnectionAuthorization(started, flow);
    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await expect(result).resolves.toBe(false);
    const calls = flow.complete.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(flow.complete).toHaveBeenCalledTimes(calls);
  });
  it("waits the device provider's polling interval and respects expiry", async () => {
    vi.useFakeTimers();
    const flow = options();
    const pending = finishConnectionAuthorization(
      {
        ...started,
        userCode: "ABCD-EFGH",
        pollIntervalSeconds: 7,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      flow,
    );
    await vi.advanceTimersByTimeAsync(6_999);
    expect(flow.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(flow.complete).toHaveBeenCalledOnce();
    flow.complete.mockClear();
    await expect(
      finishConnectionAuthorization(
        { ...started, expiresAt: new Date(Date.now() - 1).toISOString() },
        flow,
      ),
    ).resolves.toBe(false);
    expect(flow.complete).not.toHaveBeenCalled();
  });
  it("rejects unsafe sign-in schemes and failed connections", async () => {
    const flow = options();
    await expect(
      finishConnectionAuthorization({ ...started, authorizationUrl: "file:///private/file" }, flow),
    ).rejects.toThrow("Invalid connection");
    expect(flow.openUrl).not.toHaveBeenCalled();
    flow.complete.mockResolvedValue({ status: "error" });
    await expect(finishConnectionAuthorization(started, flow)).rejects.toThrow("Could not connect");
  });
});
