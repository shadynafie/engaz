import type { AppEventDelivery } from "@engaz/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { retryAppEventDelivery } from "./app-event-delivery.js";

const event: AppEventDelivery = {
  triggerId: "trigger",
  accountId: "account",
  userId: "owner",
  event: "NEW_ITEM",
  payload: {},
  deliveryKey: "delivery",
};
describe("app event acceptance retries", () => {
  it("retries transient failure then lets the durable queue own the delivery", async () => {
    const receive = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => undefined);
    await retryAppEventDelivery(receive, event, new AbortController().signal, wait);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000, expect.any(AbortSignal));
  });
  it("bounds retries and exposes the final error", async () => {
    const receive = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(
      retryAppEventDelivery(receive, event, new AbortController().signal, async () => undefined),
    ).rejects.toThrow("unavailable");
    expect(receive).toHaveBeenCalledTimes(6);
  });
  it("stops immediately when the application shuts down", async () => {
    const shutdown = new AbortController();
    shutdown.abort();
    const receive = vi.fn();
    await expect(retryAppEventDelivery(receive, event, shutdown.signal)).rejects.toBeDefined();
    expect(receive).not.toHaveBeenCalled();
  });
});
