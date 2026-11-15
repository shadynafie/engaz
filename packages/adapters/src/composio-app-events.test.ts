import { Composio } from "@composio/core";
import { describe, expect, it, vi } from "vitest";
import { ComposioAppEvents } from "./composio-app-events.js";

describe("Composio app-event adapter", () => {
  it("maps installed SDK fields, preserves replay identity, and stops callbacks on close", async () => {
    let callback: ((event: unknown) => void) | undefined;
    const triggers = {
      subscribe: vi.fn(async (receive) => {
        callback = receive;
      }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new ComposioAppEvents(() => ({ triggers }) as unknown as Composio);
    const receive = vi.fn().mockResolvedValue(undefined);
    await adapter.subscribe(receive);
    const sdkEvent = {
      id: "trigger",
      userId: "owner",
      triggerSlug: "NEW_ITEM",
      payload: { id: "item", text: "first" },
      metadata: { connectedAccount: { id: "account" } },
    };
    callback!(sdkEvent);
    await Promise.resolve();
    callback!(sdkEvent);
    await Promise.resolve();
    callback!({ ...sdkEvent, payload: { id: "item", text: "changed" } });
    await Promise.resolve();
    expect(receive).toHaveBeenCalledTimes(3);
    const [first, replay, changed] = receive.mock.calls.map(([delivery]) => delivery);
    expect(first).toMatchObject({
      triggerId: "trigger",
      accountId: "account",
      userId: "owner",
      event: "NEW_ITEM",
      payload: sdkEvent.payload,
    });
    expect(first.deliveryKey).toBe(replay.deliveryKey);
    expect(changed.deliveryKey).not.toBe(first.deliveryKey);
    await adapter.close();
    callback!(sdkEvent);
    expect(receive).toHaveBeenCalledTimes(3);
    expect(triggers.unsubscribe).toHaveBeenCalledOnce();
  });
  it("reconnects after asynchronous subscription rejection and cancels retries on close", async () => {
    vi.useFakeTimers();
    try {
      let rejectSubscription: (() => void) | undefined;
      const triggers = {
        subscribe: vi.fn(async (_receive, _filters, onError) => {
          rejectSubscription = onError;
        }),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };
      const adapter = new ComposioAppEvents(() => ({ triggers }) as unknown as Composio);
      await adapter.subscribe(async () => undefined);
      expect(() => rejectSubscription!()).not.toThrow();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(triggers.subscribe).toHaveBeenCalledTimes(2);
      expect(triggers.unsubscribe).toHaveBeenCalledOnce();
      rejectSubscription!();
      await adapter.subscribe(async () => undefined);
      rejectSubscription!();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(triggers.subscribe).toHaveBeenCalledTimes(4);
      rejectSubscription!();
      await adapter.close();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(triggers.subscribe).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("patched SDK forwards channel auth failure instead of throwing from the event callback", async () => {
    const sdk = new Composio({ apiKey: "offline-test-key" });
    const callbacks = new Map<string, (data: { error: string }) => void>();
    const channel = { bind: vi.fn((name, callback) => callbacks.set(name, callback)) };
    const internal = sdk.triggers as unknown as {
      pusherService: { getPusherClient: () => Promise<unknown> };
    };
    const disconnect = vi.fn();
    internal.pusherService.getPusherClient = async () => ({
      subscribe: async () => channel,
      unsubscribe: vi.fn(),
      disconnect,
    });
    const onError = vi.fn();
    await sdk.triggers.subscribe(() => undefined, {}, onError);
    expect(() =>
      callbacks.get("pusher:subscription_error")!({ error: "offline refusal" }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    await sdk.triggers.unsubscribe();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
