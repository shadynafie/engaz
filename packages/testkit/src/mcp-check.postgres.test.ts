import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
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
      reply({ tools: tools.map((name) => ({ name, inputSchema: { type: "object" } })) });
    } else {
      response.writeHead(202).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://localhost:${(server.address() as AddressInfo).port}/mcp`, server };
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
      const signup = await handles.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: fixtureOrigin },
        body: JSON.stringify({
          email: `mcp-check-${randomUUID()}@engaz.test`,
          password: "password12",
          name: "MCP check",
        }),
      });
      const cookie = sessionCookieHeader(signup);

      const added = await rpc<McpServer>(handles.app, cookie, "mcp/servers/create", {
        slug: "fixture",
        name: "Fixture",
        transport: "streamable_http",
        endpoint: mcp.url,
      });
      expect(added.check).toMatchObject({ status: "working", tools: ["search", "fetch"] });
      expect(added.check.checkedAt).toEqual(expect.any(String));

      const unreachable = await handles.app.request("/rpc/mcp/servers/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
        body: JSON.stringify({
          json: {
            slug: "nothing-here",
            name: "Nothing here",
            transport: "streamable_http",
            endpoint: "http://localhost:9/mcp",
          },
        }),
      });
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
