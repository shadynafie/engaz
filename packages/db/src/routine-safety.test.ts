import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "./client.js";
import { recordRoutineOutcome, routineIsStale } from "./routine-safety.js";

function fixture(failureStreak = 0, generation = 0) {
  const routine = {
    id: "routine-1",
    name: "Daily review",
    active: true,
    failureStreak,
    generation,
    pauseReason: null,
  };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const { generation: change, ...fields } = data;
    Object.assign(routine, fields);
    if (change) routine.generation += 1;
    return routine;
  });
  const tx = {
    $queryRaw: vi.fn(async () => []),
    run: {
      findUnique: vi.fn(async () => ({
        routineId: routine.id,
        routineGeneration: 0,
        routineScheduledFor: new Date(),
      })),
    },
    routine: { findUnique: vi.fn(async () => routine), update },
  };
  return { routine, update, tx: tx as unknown as Prisma.TransactionClient };
}

describe("routine failure safety", () => {
  it("notifies first failure, stays quiet on the next, then pauses with an explanation", async () => {
    const { routine, tx } = fixture();
    expect(await recordRoutineOutcome(tx, "run-1", "failed")).toMatchObject({ notify: true });
    expect(await recordRoutineOutcome(tx, "run-2", "failed")).toBeNull();
    expect(await recordRoutineOutcome(tx, "run-3", "failed")).toMatchObject({
      text: expect.stringContaining("Paused after 3"),
    });
    expect(routine).toMatchObject({ failureStreak: 3, active: false, nextRunAt: null });
    expect(await recordRoutineOutcome(tx, "run-4", "failed")).toBeNull();
  });

  it("a successful terminal occurrence resets the streak", async () => {
    const { routine, tx } = fixture(2);
    expect(await recordRoutineOutcome(tx, "run-1", "completed")).toBeNull();
    expect(routine.failureStreak).toBe(0);
    expect(await recordRoutineOutcome(tx, "run-2", "failed")).toMatchObject({ notify: true });
  });

  it("ignores a completion from before a pause/re-enable or schedule change", async () => {
    const { routine, tx, update } = fixture(2, 1);
    expect(await recordRoutineOutcome(tx, "old-run", "failed")).toBeNull();
    expect(await recordRoutineOutcome(tx, "old-success", "completed")).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(routine).toMatchObject({ failureStreak: 2, active: true });
  });

  it("does not count historical or manually tested routine runs", async () => {
    const { tx, update } = fixture();
    vi.mocked(tx.run.findUnique).mockResolvedValueOnce({
      routineId: "routine-1",
      routineGeneration: null,
    } as never);
    expect(await recordRoutineOutcome(tx, "test-run", "failed")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("stale occurrences", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("keeps the exact hour boundary and skips only older occurrences", () => {
    expect(routineIsStale({ skipStale: true }, new Date("2026-10-25T11:00:00Z"), now)).toBe(false);
    expect(routineIsStale({ skipStale: true }, new Date("2026-10-25T10:59:59Z"), now)).toBe(true);
    expect(routineIsStale({ skipStale: true }, new Date("2026-10-25T13:00:00Z"), now)).toBe(false);
  });
  it("preserves overdue execution when protection is not enabled", () => {
    expect(routineIsStale({ skipStale: false }, new Date("2026-01-01T00:00:00Z"), now)).toBe(false);
  });
});
