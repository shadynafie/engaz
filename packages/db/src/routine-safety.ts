import type { Prisma } from "./client.js";

export const ROUTINE_FAILURE_LIMIT = 3;
export const ROUTINE_STALE_AFTER_MS = 60 * 60 * 1_000;
export const SCHEDULER_HEALTH_WINDOW_MS = 90_000;

export function routineIsStale(
  routine: { skipStale: boolean },
  scheduledFor: Date,
  now = new Date(),
): boolean {
  return routine.skipStale && now.getTime() - scheduledFor.getTime() > ROUTINE_STALE_AFTER_MS;
}

/** Called only by the winning terminal transition, inside its transaction. */
export async function recordRoutineOutcome(
  tx: Prisma.TransactionClient,
  runId: string,
  outcome: "completed" | "failed",
): Promise<{ text: string; notify: boolean } | null> {
  const run = await tx.run.findUnique({
    where: { id: runId },
    select: { routineId: true, routineGeneration: true, routineScheduledFor: true },
  });
  if (!run?.routineId || run.routineGeneration == null || !run.routineScheduledFor) return null;
  // Serializing on the routine also fences a manual pause/re-enable against old outcomes.
  await tx.$queryRaw`SELECT id FROM routines WHERE id = ${run.routineId} FOR UPDATE`;
  const routine = await tx.routine.findUnique({ where: { id: run.routineId } });
  if (!routine || routine.generation !== run.routineGeneration) return null;
  const failureStreak = outcome === "completed" ? 0 : routine.failureStreak + 1;
  const paused = routine.active && failureStreak >= ROUTINE_FAILURE_LIMIT;
  const pauseReason = paused
    ? `Paused after ${ROUTINE_FAILURE_LIMIT} consecutive scheduled failures.`
    : routine.pauseReason;
  await tx.routine.update({
    where: { id: routine.id },
    data: {
      failureStreak,
      ...(paused
        ? { active: false, nextRunAt: null, pauseReason, generation: { increment: 1 } }
        : {}),
    },
  });
  if (outcome === "completed" || (failureStreak !== 1 && !paused)) return null;
  return {
    text: paused
      ? `${routine.name}: ${pauseReason} Review the failed runs before enabling it again.`
      : `${routine.name}: scheduled work failed. Further failures will pause this routine after ${ROUTINE_FAILURE_LIMIT} consecutive failures.`,
    notify: failureStreak === 1 || paused,
  };
}
