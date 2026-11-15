import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppEventDelivery } from "@engaz/adapter-kit";
import { ComposioEmulator, EncryptedSecretStore } from "@engaz/adapters";
import { createThreadEvents } from "@engaz/db";
import { describe, expect, it, vi } from "vitest";
import { createRoutineAppEvents } from "../../../apps/api/src/routine-app-events.js";
import { sessionCookieHeader } from "./index.js";

describe.skipIf(process.env.VERIFY_DATABASE !== "1")("durable app-event acceptance", () => {
  it("deduplicates deliveries and rolls back pause/revoke races in thread lock order", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "engaz-app-events-"));
    const { createApp } = await import("../../../apps/api/src/app.ts");
    const handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      realtimeDatabaseUrl: process.env.DATABASE_URL!,
      dataDir,
      authUrl: "http://127.0.0.1:7791",
      webOrigin: "http://127.0.0.1:7791",
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioEmulator(),
      encryptionKey: "app-event-fixture-encryption-key",
    });
    const prisma = handles.prisma;
    try {
      const response = await handles.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:7791" },
        body: JSON.stringify({
          email: `events-${randomUUID()}@engaz.test`,
          password: "test-password-123",
          name: "Event owner",
        }),
      });
      expect(response.ok).toBe(true);
      const cookie = sessionCookieHeader(response);
      const botsResponse = await handles.app.request("/rpc/bots/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          json: {
            name: "Event agent",
            title: "Event agent",
            description: "Offline event fixture",
            instructions: "",
            notifyOnFinish: true,
          },
        }),
      });
      expect(botsResponse.ok).toBe(true);
      const { json: created } = (await botsResponse.json()) as { json: { id: string } };
      const bot = await prisma.bot.findUniqueOrThrow({
        where: { id: created.id },
        include: { thread: true },
      });
      const owned = { spaceId: bot.spaceId, userId: bot.userId };
      const connection = await prisma.connection.create({
        data: {
          ...owned,
          provider: "mail",
          displayName: "Mail",
          status: "connected",
          providerRef: "fake-account",
        },
      });
      const source = new ComposioEmulator().appEvents;
      const triggerId = await source.create(bot.userId, "fake-account", "NEW_ITEM");
      const routine = await prisma.routine.create({
        data: {
          ...owned,
          botId: bot.id,
          name: "Review incoming items",
          prompt: "Summarize the new item",
          active: true,
          crons: ["0 0 1 1 *"],
          appEvent: {
            connectionId: connection.id,
            provider: "mail",
            triggerId,
            event: "NEW_ITEM",
            name: "New item",
          },
        },
      });
      const events = createThreadEvents(prisma);
      const enqueue = vi.fn(async () => undefined);
      let acceptanceStarted: (() => void) | undefined;
      const deliveryDeps = {
        prisma,
        secrets: new EncryptedSecretStore("fake-event-secret"),
        jobs: { enqueue },
        events: {
          sendUserMessage: (input) => {
            acceptanceStarted?.();
            return events.sendUserMessage(input);
          },
        },
      };
      const service = createRoutineAppEvents(deliveryDeps, source);
      await service.start();
      const delivery: AppEventDelivery = {
        triggerId,
        accountId: "fake-account",
        userId: bot.userId,
        event: "NEW_ITEM",
        payload: { title: "<untrusted>" },
        deliveryKey: "first",
      };
      await Promise.all([
        source.emit(triggerId, delivery.payload, delivery.deliveryKey),
        source.emit(triggerId, delivery.payload, delivery.deliveryKey),
      ]);
      const where = { threadId: bot.thread!.id, clientNonce: { not: null } };
      expect(await prisma.message.count({ where })).toBe(1);
      expect(await prisma.run.count({ where: { botId: bot.id, trigger: "webhook" } })).toBe(1);
      const durableCounts = () =>
        Promise.all([
          prisma.task.count({ where: { threadId: bot.thread!.id } }),
          prisma.event.count({ where: { threadId: bot.thread!.id } }),
        ]);
      const acceptedCounts = await durableCounts();
      const original = await prisma.message.findFirstOrThrow({ where });
      expect(JSON.stringify(original.blocks)).toContain("&lt;untrusted&gt;");
      await service.receive({ ...delivery, accountId: "wrong-account", deliveryKey: "wrong" });
      expect(await prisma.message.count({ where })).toBe(1);

      // A scheduled run holds thread first, then edits the routine. Event acceptance must use
      // that same order and roll back its tentative message when it sees the pause.
      let pausedDelivery!: Promise<void>;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${bot.thread!.id} FOR UPDATE`;
        const started = new Promise<void>((resolve) => {
          acceptanceStarted = resolve;
        });
        pausedDelivery = service.receive({ ...delivery, deliveryKey: "paused" });
        await started;
        await tx.routine.update({
          where: { id: routine.id },
          data: { active: false, generation: { increment: 1 } },
        });
      });
      await pausedDelivery;
      expect(await durableCounts()).toEqual(acceptedCounts);
      acceptanceStarted = undefined;
      expect(await prisma.message.count({ where })).toBe(1);
      expect(await prisma.run.count({ where: { botId: bot.id, trigger: "webhook" } })).toBe(1);
      await prisma.routine.update({ where: { id: routine.id }, data: { active: true } });

      let revokedDelivery!: Promise<void>;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM routines WHERE id = ${routine.id} FOR UPDATE`;
        const started = new Promise<void>((resolve) => {
          acceptanceStarted = resolve;
        });
        revokedDelivery = service.receive({ ...delivery, deliveryKey: "revoked" });
        await started;
        await tx.connection.update({
          where: { id: connection.id },
          data: { status: "disconnected" },
        });
      });
      await revokedDelivery;
      expect(await durableCounts()).toEqual(acceptedCounts);
      acceptanceStarted = undefined;
      expect(await prisma.message.count({ where })).toBe(1);
      expect(await prisma.run.count({ where: { botId: bot.id, trigger: "webhook" } })).toBe(1);
      await service.stop();
      await prisma.connection.update({
        where: { id: connection.id },
        data: { status: "connected" },
      });
      const resumed = createRoutineAppEvents(deliveryDeps, source);
      await resumed.start();
      await source.emit(triggerId, { title: "After reconnect" }, "after-reconnect");
      await source.emit(triggerId, delivery.payload, delivery.deliveryKey);
      expect(await prisma.message.count({ where })).toBe(2);
      await resumed.stop();
    } finally {
      await handles.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
