import type { AppEventDelivery, AppEventProvider } from "@engaz/adapter-kit";
import type { Actor } from "@engaz/contracts";
import { AppEventBindingSchema } from "@engaz/contracts";
import { IsolationError, Prisma } from "@engaz/db";
import { getLogger } from "@engaz/logging";
import { ORPCError } from "@orpc/server";
import type { WebhookDeps } from "./webhook-inbound.js";
import { deliverWebhookEvent, formatUntrustedDeliveryPayload } from "./webhook-inbound.js";

class AppEventRevoked extends Error {}

export function createRoutineAppEvents(deps: WebhookDeps, provider?: AppEventProvider) {
  let subscribing: Promise<void> | undefined;
  let stopped = false;
  const requireProvider = () => {
    if (!provider)
      throw new ORPCError("BAD_REQUEST", { message: "App events are not configured." });
    return provider;
  };
  const connectionFor = async (actor: Actor, id: string) => {
    const connection = await deps.prisma.connection.findFirst({
      where: {
        id,
        spaceId: actor.spaceId,
        userId: actor.userId,
        status: "connected",
        connectorId: "composio",
      },
    });
    if (!connection?.providerRef) throw new IsolationError();
    return connection;
  };
  const routineFor = async (actor: Actor, id: string) => {
    const routine = await deps.prisma.routine.findFirst({
      where: { id, spaceId: actor.spaceId, userId: actor.userId, bot: { archivedAt: null } },
    });
    if (!routine) throw new IsolationError();
    return routine;
  };
  async function receive(event: AppEventDelivery) {
    if (stopped || !event.userId || !event.accountId || !event.deliveryKey) return;
    if (JSON.stringify(event.payload).length > 64 * 1024) return;
    const routines = await deps.prisma.routine.findMany({
      where: {
        active: true,
        userId: event.userId,
        appEvent: { path: ["triggerId"], equals: event.triggerId },
        bot: { archivedAt: null },
      },
      include: { bot: { include: { thread: true } } },
    });
    for (const routine of routines) {
      const binding = AppEventBindingSchema.safeParse(routine.appEvent);
      if (!binding.success || binding.data.event !== event.event || !routine.bot.thread) continue;
      const connection = await deps.prisma.connection.findFirst({
        where: {
          id: binding.data.connectionId,
          spaceId: routine.spaceId,
          userId: routine.userId,
          connectorId: "composio",
          status: "connected",
          providerRef: event.accountId,
        },
      });
      if (!connection || connection.provider !== binding.data.provider) continue;
      try {
        await deliverWebhookEvent(
          deps,
          { bot: routine.bot, threadId: routine.bot.thread.id },
          {
            source: "webhook",
            idempotencyKey: `app-event:${routine.id}:${event.triggerId}:${event.deliveryKey}`,
            prompt: formatUntrustedDeliveryPayload("App event", {
              event: binding.data.name,
              payload: event.payload,
            }),
            routines: [routine],
            allowParallelRun: true,
            beforeAccept: async (tx) => {
              // sendUserMessage already holds the thread lock: keep thread → routine → connection order.
              await tx.$queryRaw`SELECT id FROM routines WHERE id = ${routine.id} FOR SHARE`;
              await tx.$queryRaw`SELECT id FROM connections WHERE id = ${connection.id} FOR SHARE`;
              const current = await tx.routine.findFirst({
                where: { id: routine.id, active: true, generation: routine.generation },
              });
              const connected = await tx.connection.findFirst({
                where: { id: connection.id, status: "connected", providerRef: event.accountId },
              });
              if (!current || !connected || stopped) throw new AppEventRevoked();
            },
          },
        );
      } catch (error) {
        if (!(error instanceof AppEventRevoked)) throw error;
      }
    }
  }
  async function ensureSubscribed(reconnect = false) {
    if (stopped || !provider) return;
    if (reconnect) subscribing = undefined;
    subscribing ??= provider.subscribe(receive).catch((error) => {
      subscribing = undefined;
      throw error;
    });
    await subscribing;
  }
  return {
    async start() {
      if (!provider) return;
      const existing = await deps.prisma.routine.findFirst({
        where: { appEvent: { not: Prisma.DbNull } },
        select: { id: true },
      });
      if (existing) await ensureSubscribed();
    },
    async types(actor: Actor, connectionId: string) {
      const connection = await connectionFor(actor, connectionId);
      return requireProvider().listTypes(connection.provider);
    },
    async connect(
      actor: Actor,
      input: {
        routineId: string;
        connectionId: string;
        event: string;
        config: Record<string, unknown>;
      },
    ) {
      const routine = await routineFor(actor, input.routineId);
      const connection = await connectionFor(actor, input.connectionId);
      if (routine.quietBriefing)
        throw new ORPCError("BAD_REQUEST", { message: "Quiet briefings use schedules only." });
      if (routine.appEvent)
        throw new ORPCError("BAD_REQUEST", {
          message: "Remove the saved app event before connecting another.",
        });
      if (JSON.stringify(input.config).length > 16_384)
        throw new ORPCError("BAD_REQUEST", { message: "Event settings are too large." });
      const source = requireProvider();
      const type = (await source.listTypes(connection.provider)).find(
        (item) => item.slug === input.event,
      );
      if (!type)
        throw new ORPCError("BAD_REQUEST", { message: "Choose an event offered by this app." });
      await ensureSubscribed(true);
      let triggerId: string | undefined;
      let applied = false;
      try {
        await deps.prisma.$transaction(
          async (tx) => {
            // The upstream upsert is shared per account/event; serialize setup and final cleanup.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('routine-app-event-lifecycle'))::text`;
            await tx.$queryRaw`SELECT id FROM routines WHERE id = ${routine.id} FOR UPDATE`;
            const current = await tx.routine.findFirst({
              where: {
                id: routine.id,
                spaceId: actor.spaceId,
                userId: actor.userId,
                generation: routine.generation,
              },
            });
            if (
              !current ||
              current.generation !== routine.generation ||
              current.appEvent ||
              current.quietBriefing
            ) {
              throw new ORPCError("CONFLICT", { message: "This routine changed. Try again." });
            }
            await tx.$queryRaw`SELECT id FROM bots WHERE id = ${routine.botId} FOR SHARE`;
            const bot = await tx.bot.findFirst({ where: { id: routine.botId, archivedAt: null } });
            if (!bot) throw new IsolationError();
            await tx.$queryRaw`SELECT id FROM connections WHERE id = ${connection.id} FOR SHARE`;
            const connected = await tx.connection.findFirst({
              where: {
                id: connection.id,
                status: "connected",
                providerRef: connection.providerRef,
              },
            });
            if (!connected)
              throw new ORPCError("CONFLICT", {
                message: "This app connection changed. Try again.",
              });
            const accounts = await tx.connection.findMany({
              where: {
                userId: actor.userId,
                connectorId: "composio",
                providerRef: connection.providerRef,
              },
              select: { id: true },
            });
            const used = await tx.routine.findFirst({
              where: {
                id: { not: routine.id },
                AND: [
                  {
                    OR: accounts.map((account) => ({
                      appEvent: { path: ["connectionId"], equals: account.id },
                    })),
                  },
                  { appEvent: { path: ["event"], equals: type.slug } },
                ],
              },
              select: { id: true },
            });
            if (used)
              throw new ORPCError("CONFLICT", {
                message: "This app event already runs another routine.",
              });
            triggerId = await source.create(
              actor.userId,
              connection.providerRef!,
              input.event,
              input.config,
            );
            const binding = {
              connectionId: connection.id,
              provider: connection.provider,
              triggerId,
              event: type.slug,
              name: type.name,
            };
            const updated = await tx.routine.updateMany({
              where: {
                id: routine.id,
                userId: actor.userId,
                spaceId: actor.spaceId,
                generation: routine.generation,
              },
              data: { appEvent: binding, generation: { increment: 1 } },
            });
            if (updated.count !== 1)
              throw new ORPCError("CONFLICT", { message: "This routine changed. Try again." });
          },
          { timeout: 25_000 },
        );
        applied = true;
      } finally {
        if (!applied && triggerId) await removeUnreferenced(triggerId);
      }
      return deps.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    },
    async disconnect(actor: Actor, routineId: string) {
      const routine = await routineFor(actor, routineId);
      const noOtherTrigger =
        !routine.crons.length &&
        !routine.webhookEnabled &&
        !routine.githubEnabled &&
        !routine.messageProvider;
      const update = await deps.prisma.routine.updateMany({
        where: {
          id: routine.id,
          generation: routine.generation,
          spaceId: actor.spaceId,
          userId: actor.userId,
        },
        data: {
          appEvent: Prisma.DbNull,
          generation: { increment: 1 },
          ...(noOtherTrigger ? { active: false, nextRunAt: null } : {}),
        },
      });
      if (update.count !== 1)
        throw new ORPCError("CONFLICT", { message: "This routine changed. Try again." });
      const updated = await deps.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
      const previous = AppEventBindingSchema.safeParse(routine.appEvent);
      if (previous.success) await removeUnreferenced(previous.data.triggerId);
      return updated;
    },
    async cleanup(binding: unknown) {
      const previous = AppEventBindingSchema.safeParse(binding);
      if (previous.success) await removeUnreferenced(previous.data.triggerId);
    },
    receive,
    async stop() {
      stopped = true;
      await Promise.race([
        provider?.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          timer.unref();
        }),
      ]);
    },
  };
  async function removeUnreferenced(triggerId: string) {
    if (!provider) return;
    await deps.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('routine-app-event-lifecycle'))::text`;
          const used = await tx.routine.findFirst({
            where: { appEvent: { path: ["triggerId"], equals: triggerId } },
            select: { id: true },
          });
          if (!used) await provider.remove(triggerId);
        },
        { timeout: 20_000 },
      )
      .catch((error) => getLogger().error("App event cleanup failed", error));
  }
}
export type RoutineAppEventsService = ReturnType<typeof createRoutineAppEvents>;
