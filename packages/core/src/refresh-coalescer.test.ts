import { describe, expect, it, vi } from "vitest";
import { createRefreshCoalescer } from "./refresh-coalescer.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("event refresh coalescing", () => {
  it("combines same-turn events into one read", async () => {
    const refresh = vi.fn(async () => {});
    const queue = createRefreshCoalescer(refresh);
    const pending = queue.invalidate();
    for (let i = 0; i < 100; i++) expect(queue.invalidate()).toBe(pending);
    await pending;
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("serializes bursts and retains events arriving during every trailing read", async () => {
    const reads = [deferred(), deferred(), deferred()];
    const refresh = vi.fn(() => reads[refresh.mock.calls.length - 1]!.promise);
    const queue = createRefreshCoalescer(refresh);
    const pending = queue.invalidate();
    await Promise.resolve();
    for (let i = 0; i < 100; i++) expect(queue.invalidate()).toBe(pending);
    expect(refresh).toHaveBeenCalledTimes(1);
    reads[0]!.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(queue.invalidate()).toBe(pending);
    reads[1]!.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(3);
    reads[2]!.resolve();
    await pending;
  });

  it("reconciles a failed read if another invalidation is already queued", async () => {
    const read = deferred();
    const refresh = vi.fn().mockReturnValueOnce(read.promise).mockResolvedValue(undefined);
    const queue = createRefreshCoalescer(refresh);
    const pending = queue.invalidate();
    await Promise.resolve();
    queue.invalidate();
    read.reject(new Error("offline"));
    await pending;
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reports the final failure and remains retryable", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const queue = createRefreshCoalescer(refresh);
    await expect(queue.invalidate()).rejects.toThrow("offline");
    await queue.invalidate();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("drops queued reads and future events when the subscription is disposed", async () => {
    const read = deferred();
    const refresh = vi.fn(() => read.promise);
    const queue = createRefreshCoalescer(refresh);
    const pending = queue.invalidate();
    await Promise.resolve();
    queue.invalidate();
    queue.dispose();
    read.resolve();
    await pending;
    await queue.invalidate();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps replacement subscriptions independent and accepts events after completion", async () => {
    const oldRead = deferred();
    const oldRefresh = vi.fn(() => oldRead.promise);
    const oldQueue = createRefreshCoalescer(oldRefresh);
    const oldPending = oldQueue.invalidate();
    await Promise.resolve();
    oldQueue.dispose();
    const refresh = vi.fn(async () => {});
    const queue = createRefreshCoalescer(refresh);
    await queue.invalidate().then(() => queue.invalidate());
    oldRead.resolve();
    await oldPending;
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(oldRefresh).toHaveBeenCalledTimes(1);
  });
});
