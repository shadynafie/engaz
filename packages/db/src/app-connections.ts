import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

/** Grants are scoped by both parent foreign keys; serialize against account revocation. */
export async function setAppConnectionAgents(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  input: { connectionId: string; botIds: string[] },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM connections WHERE id = ${input.connectionId} FOR UPDATE`;
    const row = await tx.connection.findFirst({
      where: { id: input.connectionId, userId: actor.userId, spaceId: actor.spaceId },
    });
    if (!row || row.status === "revoked" || (input.botIds.length > 0 && row.status !== "connected"))
      throw new IsolationError();
    const botIds = [...new Set(input.botIds)];
    const bots = await tx.bot.findMany({
      where: { id: { in: botIds }, userId: actor.userId, spaceId: actor.spaceId, archivedAt: null },
      select: { id: true },
    });
    if (bots.length !== botIds.length) throw new IsolationError();
    await tx.botConnection.deleteMany({ where: { connectionId: row.id } });
    if (botIds.length)
      await tx.botConnection.createMany({
        data: botIds.map((botId) => ({
          connectionId: row.id,
          botId,
          spaceId: actor.spaceId,
          userId: actor.userId,
        })),
      });
    const updated = await tx.connection.update({
      where: { id: row.id },
      data: { revision: { increment: 1 } },
    });
    return { row: updated, botIds };
  });
}
