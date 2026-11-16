import { describe, expect, it, vi } from "vitest";
import { setAppConnectionAgents } from "./app-connections.js";
import type { PrismaClient } from "./client.js";

const actor = { spaceId: "space", userId: "owner" };
function fixture() {
  const tx = {
    $queryRaw: vi.fn(),
    connection: {
      findFirst: vi.fn().mockResolvedValue({ id: "account", status: "connected" }),
      update: vi.fn().mockResolvedValue({ id: "account" }),
    },
    bot: { findMany: vi.fn().mockResolvedValue([{ id: "agent" }]) },
    botConnection: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
  return { tx, prisma };
}
describe("app account grants", () => {
  it("writes only explicit same-owner/same-space agent grants", async () => {
    const f = fixture();
    await setAppConnectionAgents(f.prisma, actor, {
      connectionId: "account",
      botIds: ["agent", "agent"],
    });
    expect(f.tx.bot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["agent"] }, spaceId: "space", userId: "owner", archivedAt: null },
      }),
    );
    expect(f.tx.botConnection.createMany).toHaveBeenCalledWith({
      data: [{ connectionId: "account", botId: "agent", spaceId: "space", userId: "owner" }],
    });
  });
  it("rejects a foreign account or foreign agent before deleting existing grants", async () => {
    const foreign = fixture();
    foreign.tx.connection.findFirst.mockResolvedValue(null);
    await expect(
      setAppConnectionAgents(foreign.prisma, actor, { connectionId: "foreign", botIds: [] }),
    ).rejects.toThrow();
    expect(foreign.tx.botConnection.deleteMany).not.toHaveBeenCalled();
    const otherAgent = fixture();
    otherAgent.tx.bot.findMany.mockResolvedValue([]);
    await expect(
      setAppConnectionAgents(otherAgent.prisma, actor, {
        connectionId: "account",
        botIds: ["foreign"],
      }),
    ).rejects.toThrow();
    expect(otherAgent.tx.botConnection.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["pending", "error"])(
    "does not preauthorize an unverified %s account",
    async (status) => {
      const f = fixture();
      f.tx.connection.findFirst.mockResolvedValue({ id: "account", status });
      await expect(
        setAppConnectionAgents(f.prisma, actor, { connectionId: "account", botIds: ["agent"] }),
      ).rejects.toThrow();
      expect(f.tx.botConnection.deleteMany).not.toHaveBeenCalled();
      expect(f.tx.botConnection.createMany).not.toHaveBeenCalled();
      f.tx.bot.findMany.mockResolvedValue([]);
      await expect(
        setAppConnectionAgents(f.prisma, actor, { connectionId: "account", botIds: [] }),
      ).resolves.toBeDefined();
    },
  );
  it("an empty selection removes all grants and fences old discovery", async () => {
    const f = fixture();
    f.tx.bot.findMany.mockResolvedValue([]);
    await setAppConnectionAgents(f.prisma, actor, { connectionId: "account", botIds: [] });
    expect(f.tx.botConnection.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: "account" },
    });
    expect(f.tx.botConnection.createMany).not.toHaveBeenCalled();
    expect(f.tx.connection.update).toHaveBeenCalledWith({
      where: { id: "account" },
      data: { revision: { increment: 1 } },
    });
  });
});
