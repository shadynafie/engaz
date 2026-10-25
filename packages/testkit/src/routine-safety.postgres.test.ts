import { randomUUID } from "node:crypto";
import { createRunExecutor } from "@engaz/adapters";
import { createDb, createThreadEvents, finalizeRun, type PrismaClient } from "@engaz/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(databaseUrl);

describe.skipIf(!enabled)("scheduled occurrence safety (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const scopes: Array<{ organizationId: string; userId: string }> = [];
  beforeAll(() => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
  });
  afterAll(async () => {
    if (!prisma) return;
    for (const scope of scopes) {
      await prisma.organization.delete({ where: { id: scope.organizationId } });
      await prisma.user.delete({ where: { id: scope.userId } });
    }
    await close();
  });

  async function fixture(skipStale = true) {
    const id = randomUUID();
    const userId = `routine-user-${id}`;
    const organizationId = `routine-org-${id}`;
    scopes.push({ userId, organizationId });
    await prisma.user.create({
      data: { id: userId, name: "Routine owner", email: `${id}@engaz.test` },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Routine test", slug: id, createdAt: new Date() },
    });
    const space = await prisma.space.create({
      data: { id, organizationId, name: "Routine test", createdByUserId: userId },
    });
    const bot = await prisma.bot.create({
      data: { spaceId: space.id, userId, name: "Reviewer", color: "#000000" },
    });
    const thread = await prisma.thread.create({
      data: { spaceId: space.id, userId, botId: bot.id },
    });
    const routine = await prisma.routine.create({
      data: {
        spaceId: space.id,
        userId,
        botId: bot.id,
        name: "Review",
        prompt: "Review work",
        crons: ["0 * * * *"],
        active: true,
        nextRunAt: new Date(Date.now() - 1_000),
        skipStale,
      },
    });
    let occurrence = 0;
    async function run() {
      const task = await prisma.task.create({
        data: {
          spaceId: space.id,
          botId: bot.id,
          userId,
          threadId: thread.id,
          prompt: "Review work",
          status: "running",
        },
      });
      const run = await prisma.run.create({
        data: {
          spaceId: space.id,
          botId: bot.id,
          userId,
          threadId: thread.id,
          taskId: task.id,
          trigger: "routine",
          status: "running",
          routineId: routine.id,
          routineGeneration: 0,
          routineScheduledFor: new Date(1_000 * ++occurrence),
          leaseOwner: "test-worker",
          leaseFence: 1,
          startedAt: new Date(),
        },
      });
      const attempt = await prisma.attempt.create({
        data: { runId: run.id, status: "running", fence: 1 },
      });
      return {
        run,
        attempt,
        finish: (outcome: "failed" | "completed" = "failed") =>
          finalizeRun(prisma, {
            spaceId: space.id,
            botId: bot.id,
            threadId: thread.id,
            taskId: task.id,
            runId: run.id,
            attemptId: attempt.id,
            leaseOwner: "test-worker",
            leaseFence: 1,
            ...(outcome === "failed"
              ? { outcome, error: "Offline fixture failure" }
              : { outcome, blocks: [] }),
          }),
      };
    }
    return { bot, thread, routine, run };
  }

  it("counts a retried/concurrent terminal transition once and notifies once", async () => {
    const f = await fixture();
    const run = await f.run();
    const results = await Promise.all([run.finish(), run.finish()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      failureStreak: 1,
      active: true,
    });
    expect(await prisma.message.count({ where: { runId: run.run.id } })).toBe(1);
    expect(await prisma.event.count({ where: { runId: run.run.id, type: "run.failed" } })).toBe(1);
  });

  it("serializes concurrent occurrence failures, pauses once, and fences pre-enable completions", async () => {
    const f = await fixture();
    const runs = await Promise.all([f.run(), f.run(), f.run(), f.run()]);
    await Promise.all(runs.slice(0, 3).map((run) => run.finish()));
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      failureStreak: 3,
      active: false,
      nextRunAt: null,
    });
    expect(await prisma.message.count({ where: { threadId: f.thread.id } })).toBe(2);
    await prisma.routine.update({
      where: { id: f.routine.id },
      data: { active: true, generation: { increment: 1 }, failureStreak: 0, pauseReason: null },
    });
    await runs[3]!.finish();
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      generation: 2,
      failureStreak: 0,
      active: true,
    });
    expect(await prisma.message.count({ where: { threadId: f.thread.id } })).toBe(2);
  });

  it("resets the failure streak on success", async () => {
    const f = await fixture();
    await (await f.run()).finish();
    await (await f.run()).finish("completed");
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      failureStreak: 0,
    });
  });

  it("claims the exact scheduled time once even with concurrent wakeups", async () => {
    const f = await fixture();
    const enqueue = vi.fn(async () => undefined);
    const executor = createRunExecutor({
      prisma,
      events: createThreadEvents(prisma),
      jobs: { enqueue, cancel: async () => undefined, close: async () => undefined },
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    const scheduledFor = f.routine.nextRunAt!.toISOString();
    await Promise.all([
      executor.wakeRoutine(f.routine.id, scheduledFor),
      executor.wakeRoutine(f.routine.id, scheduledFor),
    ]);
    const runs = await prisma.run.findMany({ where: { routineId: f.routine.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      routineGeneration: 0,
      routineScheduledFor: f.routine.nextRunAt,
    });
  });

  it("skips a queued occurrence that became stale before execution", async () => {
    const f = await fixture();
    const queued = await f.run();
    const past = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await prisma.run.update({
      where: { id: queued.run.id },
      data: { status: "queued", startedAt: null, routineScheduledFor: past },
    });
    const executor = createRunExecutor({
      prisma,
      events: createThreadEvents(prisma),
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    await executor.continueRun(queued.run.id, "late-worker");
    expect(await prisma.run.findUnique({ where: { id: queued.run.id } })).toMatchObject({
      status: "cancelled",
    });
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      lastSkippedAt: past,
      failureStreak: 0,
    });
  });

  it.each([true, false])("skips stale work only when enabled (%s)", async (skipStale) => {
    const f = await fixture(skipStale);
    const past = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await prisma.routine.update({ where: { id: f.routine.id }, data: { nextRunAt: past } });
    const executor = createRunExecutor({
      prisma,
      events: createThreadEvents(prisma),
      jobs: {
        enqueue: async () => undefined,
        cancel: async () => undefined,
        close: async () => undefined,
      },
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    await executor.wakeRoutine(f.routine.id, past.toISOString());
    expect(await prisma.run.count({ where: { routineId: f.routine.id } })).toBe(skipStale ? 0 : 1);
    expect(await prisma.routine.findUnique({ where: { id: f.routine.id } })).toMatchObject({
      lastSkippedAt: skipStale ? past : null,
    });
  });
});
