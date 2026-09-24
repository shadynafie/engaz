import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@engaz/adapters";
import type { McpServer } from "@engaz/contracts";
import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const fixtureOrigin = "http://127.0.0.1:7791";

/** Answers the MCP handshake and tool listing with plain JSON over Streamable HTTP. */
async function startMcpServer(tools: string[]): Promise<{ url: string; server: Server }> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.method !== "POST") return void response.writeHead(405).end();
    const message = JSON.parse(body) as { id?: number; method?: string };
    const reply = (result: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    };
    if (message.method === "initialize") {
      reply({
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      });
    } else if (message.method === "tools/list") {
      reply({
        tools: tools.map((name) => ({
          name,
          description: `Use ${name}.\n\nArgs: none`,
          inputSchema: { type: "object" },
        })),
      });
    } else {
      response.writeHead(202).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://localhost:${(server.address() as AddressInfo).port}/mcp`, server };
}

/** An older server that speaks only SSE: a GET stream carries every reply. */
async function startSseMcpServer(): Promise<{ url: string; server: Server }> {
  let stream: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/sse") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write("event: endpoint\ndata: /messages\n\n");
      stream = response;
      return;
    }
    if (request.method !== "POST" || request.url !== "/messages") {
      return void response.writeHead(405).end();
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(202).end();
    const message = JSON.parse(body) as { id?: number; method?: string };
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "legacy", version: "1" },
          }
        : message.method === "tools/list"
          ? { tools: [{ name: "lookup", inputSchema: { type: "object" } }] }
          : undefined;
    if (result && message.id !== undefined) {
      stream?.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`,
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://localhost:${(server.address() as AddressInfo).port}/sse`, server };
}

describe.skipIf(!databaseAvailable)("MCP server connection check", () => {
  it("keeps a reachable server with its tools and refuses one that cannot be reached", async () => {
    const mcp = await startMcpServer(["search", "fetch"]);
    const dataDir = await mkdtemp(path.join(tmpdir(), "engaz-mcp-check-"));
    let stop: (() => Promise<void>) | undefined;
    try {
      const { createApp } = await import("../../../apps/api/src/app.ts");
      const handles = await createApp({
        databaseUrl: process.env.DATABASE_URL!,
        realtimeDatabaseUrl: process.env.DATABASE_URL!,
        authUrl: fixtureOrigin,
        webOrigin: fixtureOrigin,
        dataDir,
        sandboxProvider: "fake",
        agentRuntime: "scripted",
        wakeupDriver: "memory",
        signupsEnabled: "true",
        composio: new ComposioEmulator(),
        encryptionKey: "mcp-check-fixture-encryption-key",
      });
      stop = handles.stop;
      const cookie = await signup(handles.app, "MCP check");
      // Other suites share this database, so make this account the owner explicitly.
      const me = await rpc<{ userId: string }>(handles.app, cookie, "me");
      await handles.prisma.deploymentSettings.update({
        where: { id: "default" },
        data: { ownerUserId: me.userId },
      });

      const added = await rpc<McpServer>(handles.app, cookie, "mcp/servers/create", {
        slug: "fixture",
        name: "Fixture",
        transport: "streamable_http",
        endpoint: mcp.url,
      });
      expect(added.check).toMatchObject({
        status: "working",
        tools: ["search", "fetch"],
        // The owner sees what each tool does, without the argument notes meant for the model.
        toolDescriptions: { search: "Use search.", fetch: "Use fetch." },
      });
      expect(added.check.checkedAt).toEqual(expect.any(String));

      // Giving an agent the server grants the tools it offers now, not whatever it adds later.
      const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
        name: "Researcher",
        title: "Researcher",
        description: "uses the fixture",
        instructions: "",
        notifyOnFinish: true,
      });
      const assignment = await rpc<{ allowAllTools: boolean; allowedTools: string[] }>(
        handles.app,
        cookie,
        "mcp/assignments/approve",
        { botId: bot.id, serverId: added.id },
      );
      expect(assignment).toMatchObject({ allowAllTools: false, allowedTools: ["search", "fetch"] });

      // Plain HTTP is for the owner's own network; on the internet it would expose the token.
      const plainInternet = await create(handles.app, cookie, "http://203.0.113.10/mcp");
      expect(plainInternet.status).toBe(400);
      expect(await plainInternet.text()).toContain("Servers on the internet need an https://");

      // Other accounts cannot point Engaz at the owner's network.
      const member = await signup(handles.app, "MCP member");
      const memberLocal = await create(handles.app, member, mcp.url);
      expect(memberLocal.status).toBe(403);
      expect(await memberLocal.text()).toContain("Only the owner can add servers");

      // The owner never picks a connection type: an SSE-only server is found on its own.
      const legacy = await startSseMcpServer();
      try {
        const sse = await rpc<McpServer>(handles.app, cookie, "mcp/servers/create", {
          slug: "legacy",
          name: "Legacy",
          transport: "streamable_http",
          endpoint: legacy.url,
        });
        expect(sse).toMatchObject({ transport: "sse", check: { status: "working" } });
        expect(sse.check.tools).toEqual(["lookup"]);
        await rpc(handles.app, cookie, "mcp/servers/remove", { id: sse.id });
      } finally {
        legacy.server.closeAllConnections();
        legacy.server.close();
      }

      const unreachable = await create(handles.app, cookie, "http://localhost:9/mcp");
      expect(unreachable.status).toBe(400);
      const servers = await rpc<McpServer[]>(handles.app, cookie, "mcp/servers/list");
      expect(servers.map((server) => server.slug)).toEqual(["fixture"]);

      await new Promise<void>((resolve) => mcp.server.close(() => resolve()));
      const rechecked = await rpc<McpServer>(handles.app, cookie, "mcp/servers/check", {
        id: added.id,
      });
      expect(rechecked.check).toMatchObject({
        status: "failing",
        message: "Couldn't reach the server. Check that it's running and the address is right.",
        tools: ["search", "fetch"],
      });
    } finally {
      mcp.server.close();
      await stop?.();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});

async function signup(app: App, name: string): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({
      email: `mcp-check-${randomUUID()}@engaz.test`,
      password: "password12",
      name,
    }),
  });
  return sessionCookieHeader(response);
}

function create(app: App, cookie: string, endpoint: string): Promise<Response> {
  return app.request("/rpc/mcp/servers/create", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({
      json: { slug: "other", name: "Other", transport: "streamable_http", endpoint },
    }),
  });
}

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json?: T & { message?: string } };
  if (response.status >= 400)
    throw new Error(`${procedure}: ${body.json?.message ?? response.status}`);
  return body.json as T;
}
