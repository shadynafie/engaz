import type { PrismaClient } from "@engaz/db";
import { describe, expect, it, vi } from "vitest";
import { quietBriefingContext } from "./quiet-briefing.js";

const routine = { id: "briefing", spaceId: "space", userId: "owner" };
function fixture() {
  const run = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const message = { findFirst: vi.fn().mockResolvedValue(null) };
  const scratchpadItem = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  return {
    run,
    message,
    scratchpadItem,
    prisma: { run, message, scratchpadItem } as unknown as PrismaClient,
  };
}
describe("quiet briefings", () => {
  it("does not call a model or consume attention when there is nothing new", async () => {
    const f = fixture();
    expect(await quietBriefingContext(f.prisma, routine)).toBeNull();
    expect(f.run.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "completed", routineId: routine.id }),
      }),
    );
  });
  it("does not interrupt active work or a recent user conversation", async () => {
    const active = fixture();
    active.run.findFirst.mockResolvedValueOnce({ id: "running" });
    expect(await quietBriefingContext(active.prisma, routine)).toBeNull();
    expect(active.message.findFirst).not.toHaveBeenCalled();
    const recent = fixture();
    recent.message.findFirst.mockResolvedValue({ id: "user-message" });
    expect(await quietBriefingContext(recent.prisma, routine)).toBeNull();
    expect(recent.run.findMany).not.toHaveBeenCalled();
  });
  it("uses only this owner's changes since the last completed briefing snapshot", async () => {
    const f = fixture();
    const briefingSnapshotAt = new Date("2026-11-15T09:00:00Z");
    const now = new Date("2026-11-15T10:00:00Z");
    f.run.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ briefingSnapshotAt });
    f.scratchpadItem.findMany.mockResolvedValue([
      { id: "work", title: "Review draft", bot: { name: "Writer" } },
    ]);
    f.scratchpadItem.count.mockResolvedValue(27);
    const context = await quietBriefingContext(f.prisma, routine, now);
    expect(context).toContain('"blocked":27');
    expect(context).toContain("only the latest 10");
    expect(context).toContain("Review draft");
    expect(f.scratchpadItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner",
          spaceId: "space",
          status: "parked",
          updatedAt: { gt: briefingSnapshotAt, lte: now },
        },
      }),
    );
  });
});
