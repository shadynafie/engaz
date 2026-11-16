import type { AdapterContext, ConnectorCall } from "@engaz/adapter-kit";
import type { PrismaClient } from "@engaz/db";
import { describe, expect, it, vi } from "vitest";
import { currentConnectionContext } from "./connection-grants.js";

const context: AdapterContext = {
  operationId: "operation",
  traceId: "trace",
  userId: "owner",
  spaceId: "space",
  botId: "agent",
  signal: new AbortController().signal,
  connectedConnections: [
    {
      id: "account",
      connectorId: "direct",
      externalId: "google",
      displayName: "Work",
      providerRef: "current",
    },
  ],
};
const call: ConnectorCall = {
  tool: "read",
  executionId: "effect",
  args: {},
  route: { connectorId: "direct", toolName: "read", resourceId: "account" },
};
function database(
  rows: {
    id: string;
    connectorId: string;
    provider: string;
    displayName: string;
    providerRef: string | null;
  }[],
) {
  const findMany = vi.fn(async () => rows);
  return { prisma: { connection: { findMany } } as unknown as PrismaClient, findMany };
}

describe("connection execution grants", () => {
  it("blocks a cached action after access is removed", async () => {
    const { prisma, findMany } = database([]);
    expect(await currentConnectionContext(prisma, call, context)).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner",
          spaceId: "space",
          connectorId: "direct",
          status: "connected",
          botConnections: { some: { botId: "agent" } },
        },
      }),
    );
  });
  it("does not replace an approved account with an account added later", async () => {
    const { prisma } = database([
      {
        id: "new-account",
        connectorId: "direct",
        provider: "google",
        displayName: "Personal",
        providerRef: "new",
      },
    ]);
    expect(await currentConnectionContext(prisma, call, context)).toBeNull();
  });
  it("retains the authorized account reference and rejects a different explicit account", async () => {
    const { prisma } = database([
      {
        id: "account",
        connectorId: "direct",
        provider: "google",
        displayName: "Work",
        providerRef: "current",
      },
    ]);
    const refreshed = await currentConnectionContext(prisma, call, context);
    expect(refreshed?.connectedConnections?.[0]?.providerRef).toBe("current");
    expect(
      await currentConnectionContext(prisma, { ...call, connectionId: "other" }, context),
    ).toBeNull();
    expect(
      await currentConnectionContext(
        prisma,
        { ...call, route: { ...call.route!, resourceId: "other" } },
        context,
      ),
    ).toBeNull();
  });
  it("rejects a replacement account behind the same connection record", async () => {
    const { prisma } = database([
      {
        id: "account",
        connectorId: "direct",
        provider: "google",
        displayName: "Work",
        providerRef: "replacement",
      },
    ]);
    expect(await currentConnectionContext(prisma, call, context)).toBeNull();
  });
  it("does not apply managed-account permissions to local MCP or custom tools", async () => {
    const { prisma, findMany } = database([]);
    expect(
      await currentConnectionContext(
        prisma,
        { ...call, route: { connectorId: "mcp", toolName: "read" } },
        context,
      ),
    ).toBe(context);
    expect(findMany).not.toHaveBeenCalled();
  });
});
