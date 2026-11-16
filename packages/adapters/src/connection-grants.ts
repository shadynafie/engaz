import type { AdapterContext, ConnectorCall } from "@engaz/adapter-kit";
import type { PrismaClient } from "@engaz/db";

/** Recheck grants after queued approvals; a run's discovery snapshot is not authority. */
export async function currentConnectionContext(
  prisma: PrismaClient,
  call: ConnectorCall,
  context: AdapterContext,
): Promise<AdapterContext | null> {
  const connectorId = call.route?.connectorId;
  if (!connectorId || !["direct", "composio", "pipedream"].includes(connectorId)) return context;
  if (!context.botId) return null;
  const originallyAllowed = new Map(
    (context.connectedConnections ?? [])
      .filter((row) => row.connectorId === connectorId)
      .map((row) => [row.id, row.providerRef ?? null]),
  );
  const rows = await prisma.connection.findMany({
    where: {
      userId: context.userId,
      spaceId: context.spaceId,
      connectorId,
      status: "connected",
      botConnections: { some: { botId: context.botId } },
    },
    select: { id: true, connectorId: true, provider: true, providerRef: true, displayName: true },
  });
  const permitted = rows.filter(
    (row) =>
      originallyAllowed.has(row.id) && originallyAllowed.get(row.id) === (row.providerRef ?? null),
  );
  if (
    !permitted.length ||
    (call.connectionId && !permitted.some((row) => row.id === call.connectionId))
  ) {
    return null;
  }
  if (connectorId === "direct" && !permitted.some((row) => row.id === call.route?.resourceId))
    return null;
  const connections = [
    ...(context.connectedConnections ?? []).filter((row) => row.connectorId !== connectorId),
    ...permitted.map((row) => ({
      id: row.id,
      connectorId: row.connectorId,
      externalId: row.provider,
      displayName: row.displayName,
      providerRef: row.providerRef ?? undefined,
    })),
  ];
  return {
    ...context,
    connectedConnections: connections,
    connectedProviders: connections
      .filter((row) => row.connectorId === "composio")
      .map((row) => row.externalId),
  };
}
