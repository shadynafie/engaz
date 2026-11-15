import type { AppEventDelivery, AppEventProvider } from "@engaz/adapter-kit";
import type { Actor } from "@engaz/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRoutineAppEvents } from "./routine-app-events.js";
import type { WebhookDeps } from "./webhook-inbound.js";

const actor = { userId: "owner", spaceId: "space" } as Actor;
const binding = {
  connectionId: "connection",
  provider: "mail",
  triggerId: "trigger",
  event: "NEW_ITEM",
  name: "New item",
};
const event: AppEventDelivery = {
  triggerId: "trigger",
  accountId: "account",
  userId: "owner",
  event: "NEW_ITEM",
  payload: { text: "<untrusted>" },
  deliveryKey: "delivery-1",
};
function fixture() {
  const row = {
    id: "routine",
    userId: "owner",
    spaceId: "space",
    generation: 2,
    active: true,
    name: "Review mail",
    prompt: "Review",
    appEvent: binding,
    crons: ["0 * * * *"],
    bot: { id: "bot", userId: "owner", spaceId: "space", thread: { id: "thread" } },
  };
  const routine = {
    findMany: vi.fn().mockResolvedValue([row]),
    findFirst: vi.fn().mockResolvedValue(row),
    findUniqueOrThrow: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const connection = {
    findFirst: vi.fn().mockResolvedValue({
      id: "connection",
      userId: "owner",
      providerRef: "account",
      provider: "mail",
    }),
  };
  const prisma = {
    routine,
    connection,
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn) => fn(prisma)),
  };
  const accepted = vi.fn();
  const sendUserMessage = vi.fn(async (input) => {
    await input.beforeAccept?.(prisma);
    accepted();
    return { messageId: "message", runId: "run", seq: 1 };
  });
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const provider: AppEventProvider = {
    listTypes: vi.fn().mockResolvedValue([{ slug: "NEW_ITEM", name: "New item", config: {} }]),
    create: vi.fn().mockResolvedValue("trigger"),
    remove: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const deps = { prisma, events: { sendUserMessage }, jobs: { enqueue } } as unknown as WebhookDeps;
  return {
    row,
    routine,
    connection,
    prisma,
    sendUserMessage,
    accepted,
    enqueue,
    provider,
    service: createRoutineAppEvents(deps, provider),
  };
}
describe("routine app events", () => {
  it("scopes deliveries to active owned routines and the exact live account", async () => {
    const f = fixture();
    await f.service.receive(event);
    expect(f.routine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          userId: "owner",
          appEvent: { path: ["triggerId"], equals: "trigger" },
        }),
      }),
    );
    expect(f.connection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "connection",
          spaceId: "space",
          userId: "owner",
          status: "connected",
          providerRef: "account",
        }),
      }),
    );
    expect(f.sendUserMessage).toHaveBeenCalledOnce();
    expect(f.sendUserMessage.mock.calls[0][0].prompt).toContain("&lt;untrusted&gt;");
    expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "run.continue" }));
  });
  it("uses a stable durable nonce for replay of the same event", async () => {
    const f = fixture();
    await f.service.receive(event);
    await f.service.receive(event);
    const [first, replay] = f.sendUserMessage.mock.calls.map(([input]) => input.clientNonce);
    expect(first).toBe(replay);
    expect(first).toMatch(/^webhook:bot:/);
  });
  it("rejects unknown users, wrong event names, and revoked accounts", async () => {
    const f = fixture();
    await f.service.receive({ ...event, userId: "" });
    await f.service.receive({ ...event, event: "DIFFERENT" });
    f.connection.findFirst.mockResolvedValue(null);
    await f.service.receive(event);
    expect(f.sendUserMessage).not.toHaveBeenCalled();
  });
  it("rechecks a pause while holding the delivery fence", async () => {
    const f = fixture();
    f.routine.findFirst.mockResolvedValue(null);
    await f.service.receive(event);
    expect(f.accepted).not.toHaveBeenCalled();
  });
  it("rejects a stale connect before the upstream upsert can change the saved configuration", async () => {
    const f = fixture();
    f.routine.findFirst
      .mockResolvedValueOnce({ ...f.row, appEvent: null })
      .mockResolvedValueOnce({ ...f.row, generation: 3 });
    await expect(
      f.service.connect(actor, {
        routineId: "routine",
        connectionId: "connection",
        event: "NEW_ITEM",
        config: { changed: true },
      }),
    ).rejects.toThrow("changed");
    expect(f.provider.create).not.toHaveBeenCalled();
  });
  it("rejects stale disconnect without deleting the new upstream trigger", async () => {
    const f = fixture();
    f.routine.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.disconnect(actor, "routine")).rejects.toThrow("changed");
    expect(f.provider.remove).not.toHaveBeenCalled();
  });
  it("checks ownership before offering upstream event types", async () => {
    const f = fixture();
    f.connection.findFirst.mockResolvedValue(null);
    await expect(f.service.types(actor, "other-connection")).rejects.toThrow();
    expect(f.provider.listTypes).not.toHaveBeenCalled();
  });
  it("shares one subscription and stops deliveries after shutdown", async () => {
    const f = fixture();
    await f.service.start();
    await f.service.start();
    expect(f.provider.subscribe).toHaveBeenCalledOnce();
    await f.service.stop();
    await f.service.receive(event);
    expect(f.provider.close).toHaveBeenCalledOnce();
    expect(f.sendUserMessage).not.toHaveBeenCalled();
  });
});
