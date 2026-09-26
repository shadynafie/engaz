import type { Actor } from "@engaz/contracts";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter, initialToolAccess } from "./router.js";

function setup(status: "working" | "failing" = "working") {
  const actor = {
    spaceId: "space",
    userId: "owner",
    email: "owner@example.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const current = {
    id: "server",
    spaceId: actor.spaceId,
    userId: actor.userId,
    slug: "demo",
    name: "Demo",
    description: "",
    transport: "streamable_http",
    endpoint: "https://example.test/mcp",
    command: null,
    args: [],
    env: {},
    headers: { "X-Api-Key": true },
    secretId: "secret",
    enabled: true,
    revision: 1,
    localNetwork: false,
    checkStatus: "working",
    checkMessage: null,
    tools: [{ name: "search" }],
    checkedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const material = {
    secret: "token",
    headers: { "X-Api-Key": "header" },
    oauth: { tokens: { access_token: "access" } },
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    mcpServer: {
      findFirst: vi.fn(async () => current),
      update: vi.fn(async ({ data }) => ({ ...current, ...data, revision: 2 })),
    },
    secret: { create: vi.fn(), deleteMany: vi.fn() },
    botMcpServer: { updateMany: vi.fn() },
  };
  const prisma = {
    mcpServer: { findFirst: vi.fn(async () => current) },
    secret: { findFirst: vi.fn(async () => ({ id: "secret", ciphertext: "stored" })) },
    $transaction: vi.fn(async (operation) => operation(tx)),
  };
  const secrets = {
    load: vi.fn(() => JSON.stringify(material)),
    put: vi.fn(async () => ({ id: "next-secret", ciphertext: "encrypted" })),
  };
  const checkMcpServer = vi.fn(async () => ({
    status,
    message: status === "failing" ? "Unavailable" : null,
    tools: status === "working" ? [{ name: "search" }] : [],
  }));
  const deps = {
    prisma,
    secrets,
    checkMcpServer,
    mcpEndpointNetwork: vi.fn(async () => "internet"),
    env: { webOrigin: "http://localhost:7791", defaultProvider: "fake", defaultModel: "fake" },
    dataDir: "/tmp/engaz-mcp-update-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const update = async (input: unknown) => {
    const { response } = await handler.handle(
      new Request("http://localhost/rpc/mcp/servers/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  };
  const config = {
    slug: current.slug,
    name: "Renamed",
    transport: "streamable_http",
    endpoint: current.endpoint,
  };
  return { update, config, tx, prisma, secrets, checkMcpServer, current, material };
}

describe("MCP configuration edits", () => {
  it("keeps the saved connection and secret when candidate discovery fails", async () => {
    const { update, config, tx, prisma, secrets, checkMcpServer } = setup("failing");
    const response = await update({
      id: "server",
      config: { ...config, endpoint: "https://new.example.test/mcp", secret: "new" },
    });
    expect(response.status).toBe(400);
    expect(checkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://new.example.test/mcp" }),
      expect.anything(),
      {
        material: { secret: "new", headers: { "X-Api-Key": "header" } },
      },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.mcpServer.update).not.toHaveBeenCalled();
    expect(secrets.put).not.toHaveBeenCalled();
  });

  it("preserves omitted header values, static credentials and OAuth during a name edit", async () => {
    const { update, config, tx, secrets, checkMcpServer, material } = setup();
    expect((await update({ id: "server", config })).status).toBe(200);
    expect(checkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed", headers: { "X-Api-Key": true } }),
      expect.anything(),
      { material },
    );
    expect(JSON.parse(secrets.put.mock.calls[0]![0] as string)).toEqual(material);
    expect(tx.mcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ headers: { "X-Api-Key": true }, checkStatus: "working" }),
      }),
    );
    expect(tx.botMcpServer.updateMany).toHaveBeenCalledWith({
      where: { serverId: "server", pendingToolDiscovery: true },
      data: { pendingToolDiscovery: false, allowAllTools: false, allowedTools: ["search"] },
    });
  });

  it("allows explicitly clearing headers while preserving the token", async () => {
    const { update, config, secrets, tx, material } = setup();
    expect((await update({ id: "server", config: { ...config, headers: {} } })).status).toBe(200);
    expect(JSON.parse(secrets.put.mock.calls[0]![0] as string)).toEqual({
      ...material,
      headers: {},
    });
    expect(tx.mcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ headers: {} }) }),
    );
  });

  it("rejects a stale edit without replacing credentials", async () => {
    const { update, config, tx, secrets, current } = setup();
    tx.mcpServer.findFirst.mockResolvedValue({ ...current, revision: 2 });
    expect((await update({ id: "server", config })).status).toBe(409);
    expect(tx.mcpServer.update).not.toHaveBeenCalled();
    expect(secrets.put).not.toHaveBeenCalled();
  });

  it("keeps refreshed OAuth credentials produced by a successful preview", async () => {
    const { update, config, secrets, checkMcpServer } = setup();
    checkMcpServer.mockImplementation(async (_server, _context, preview) => {
      preview.material.oauth.tokens.access_token = "refreshed";
      return { status: "working", message: null, tools: [{ name: "search" }] };
    });
    expect((await update({ id: "server", config })).status).toBe(200);
    expect(JSON.parse(secrets.put.mock.calls[0]![0] as string).oauth.tokens.access_token).toBe(
      "refreshed",
    );
  });
});

describe("initial MCP permissions", () => {
  it("distinguishes pending discovery from a successfully discovered empty catalog", () => {
    expect(initialToolAccess([])).toEqual({
      allowAllTools: true,
      allowedTools: [],
      pendingToolDiscovery: true,
    });
    expect(initialToolAccess([], true)).toEqual({
      allowAllTools: false,
      allowedTools: [],
      pendingToolDiscovery: false,
    });
    expect(initialToolAccess([{ name: "search" }])).toEqual({
      allowAllTools: false,
      allowedTools: ["search"],
      pendingToolDiscovery: false,
    });
  });
});
