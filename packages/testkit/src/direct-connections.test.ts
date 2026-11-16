import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AdapterContext, ConnectorCall } from "@engaz/adapter-kit";
import type { DirectAppBroker } from "@engaz/adapters";
import { DirectAppConnector, EncryptedSecretStore } from "@engaz/adapters";
import type { Bot, Connection } from "@engaz/contracts";
import { createDb } from "@engaz/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";
import { sessionCookieHeader } from "./index.js";

const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const KEY = "offline-direct-connections-encryption-key";
const IDENTITY = "offline-direct-connections-installation";
type Started = { connectionId: string; authorizationId: string; authorizationUrl: string };

describe.skipIf(!enabled)("direct connections through API and PostgreSQL", () => {
  let handles: Awaited<ReturnType<typeof createApp>>;
  let database: ReturnType<typeof createDb>;
  let dataDir: string;
  let cookie: string;
  let foreignCookie: string;
  let context: AdapterContext;
  let ownBot: Bot;
  let foreignBot: Bot;
  let connector: DirectAppConnector;
  const secrets = new EncryptedSecretStore(KEY);
  let profile = "A";
  let actionStatus = 200;
  let onAction: (() => Promise<void>) | undefined;
  const fetcher = vi.fn(async (input) => {
    if (String(input).includes("userinfo"))
      return Response.json({
        sub: `account-${profile}`,
        email: `${profile.toLowerCase()}@example.test`,
      });
    await onAction?.();
    return Response.json({ items: [] }, { status: actionStatus });
  });
  const broker: DirectAppBroker = {
    available: () => true,
    begin: async () => ({
      authorizationUrl: "https://connect.example.test/sign-in",
      sessionId: "private-pending-session",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }),
    complete: async () => ({
      accessToken: "private-access-initial",
      refreshToken: "private-refresh-initial",
      brokerCredential: "private-capability-initial",
      expiresAt: Date.now() + 3600_000,
    }),
    refresh: vi.fn(async () => ({
      accessToken: "private-access-rotated",
      refreshToken: "private-refresh-rotated",
      brokerCredential: "private-capability-rotated",
      expiresAt: Date.now() + 3600_000,
    })),
    revoke: async () => undefined,
  };
  beforeAll(async () => {
    const root = path.resolve("test-report/direct-connections");
    await mkdir(root, { recursive: true });
    dataDir = await mkdtemp(path.join(root, "data-"));
    database = createDb(process.env.DATABASE_URL!);
    connector = new DirectAppConnector({
      prisma: database.prisma,
      secrets,
      settings: {},
      identitySecret: IDENTITY,
      broker,
      fetch: fetcher as typeof fetch,
    });
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      prisma: database.prisma,
      databaseUrl: process.env.DATABASE_URL!,
      realtimeDatabaseUrl: process.env.DATABASE_URL!,
      dataDir,
      encryptionKey: KEY,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      directApps: connector,
      signupsEnabled: "true",
      signupsInviteOnly: "false",
      authUrl: "http://127.0.0.1:7791",
      webOrigin: "http://127.0.0.1:7791",
    });
    cookie = await signup();
    foreignCookie = await signup();
    const me = await rpc<{ userId: string; spaceId: string }>(cookie, "me", {});
    ownBot = await rpc<Bot>(cookie, "bots/create", {
      name: "Reader",
      title: "",
      description: "",
      instructions: "",
    });
    foreignBot = await rpc<Bot>(foreignCookie, "bots/create", {
      name: "Other reader",
      title: "",
      description: "",
      instructions: "",
    });
    context = {
      ...me,
      botId: ownBot.id,
      operationId: "direct-integration",
      traceId: "direct-integration",
      signal: new AbortController().signal,
    };
  });
  afterAll(async () => {
    await handles?.stop();
    await database?.pool.end();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });
  async function request(session: string, procedure: string, json: unknown) {
    return handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:7791",
        cookie: session,
      },
      body: JSON.stringify({ json }),
    });
  }
  async function rpc<T>(session: string, procedure: string, json: unknown): Promise<T> {
    const response = await request(session, procedure, json);
    expect(response.status, procedure).toBe(200);
    return ((await response.json()) as { json: T }).json;
  }
  async function signup() {
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:7791" },
      body: JSON.stringify({
        email: `direct-${randomUUID()}@engaz.test`,
        password: "test-password-123",
        name: "Connection owner",
      }),
    });
    expect(response.ok).toBe(true);
    return sessionCookieHeader(response);
  }
  async function changeSecret(id: string, change: (state: Record<string, any>) => void) {
    const row = await handles.prisma.connection.findUniqueOrThrow({ where: { id } });
    const secret = await handles.prisma.secret.findUniqueOrThrow({ where: { id: row.secretId! } });
    const state = JSON.parse(secrets.load(secret.ciphertext, secret.id));
    change(state);
    const replacement = await secrets.put(JSON.stringify(state), context, secret.id);
    await handles.prisma.secret.update({
      where: { id: secret.id },
      data: { ciphertext: replacement.ciphertext },
    });
  }
  async function connect(connectionId?: string) {
    const started = await rpc<Started>(cookie, "connections/begin", {
      connectorId: "direct",
      provider: "google",
      displayName: "Workspace",
      ...(connectionId ? { connectionId } : {}),
    });
    await changeSecret(started.connectionId, (state) => {
      state.nextPollAt = 0;
    });
    const connected = await rpc<Connection>(cookie, "connections/complete", {
      connectionId: started.connectionId,
      authorizationId: started.authorizationId,
    });
    return { started, connected };
  }
  async function callFor(id: string) {
    const tool = (await connector.discoverTools(context)).find(
      (item) => item.route?.resourceId === id,
    )!;
    expect(tool).toBeDefined();
    return { tool: tool.name, route: tool.route, args: { limit: 5 }, executionId: randomUUID() };
  }
  async function invoke(target: DirectAppConnector, call: ConnectorCall) {
    const events = [];
    for await (const event of target.execute(call, context)) events.push(event);
    return events;
  }

  it("uses verified sign-in, explicit grants, and database-enforced owner/space boundaries", async () => {
    const pending = await rpc<Started>(cookie, "connections/begin", {
      connectorId: "direct",
      provider: "google",
      displayName: "Unverified",
    });
    expect(
      (
        await request(cookie, "connections/setAgents", {
          connectionId: pending.connectionId,
          botIds: [ownBot.id],
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      await handles.prisma.botConnection.count({ where: { connectionId: pending.connectionId } }),
    ).toBe(0);
    await rpc(cookie, "connections/setAgents", { connectionId: pending.connectionId, botIds: [] });

    const { started, connected } = await connect();
    expect(connected).toMatchObject({
      status: "connected",
      accountLabel: "a@example.test",
      agentIds: [],
    });
    expect(connected.checkedAt).not.toBeNull();
    expect(JSON.stringify(connected)).not.toContain("private-");
    expect(
      (
        await request(foreignCookie, "connections/setAgents", {
          connectionId: started.connectionId,
          botIds: [foreignBot.id],
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await request(cookie, "connections/setAgents", {
          connectionId: started.connectionId,
          botIds: [foreignBot.id],
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    await expect(
      handles.prisma.botConnection.create({
        data: {
          connectionId: started.connectionId,
          botId: foreignBot.id,
          spaceId: context.spaceId,
          userId: context.userId,
        },
      }),
    ).rejects.toThrow();
    const assigned = await rpc<Connection>(cookie, "connections/setAgents", {
      connectionId: started.connectionId,
      botIds: [ownBot.id],
    });
    expect(assigned.agentIds).toEqual([ownBot.id]);
    expect((await invoke(connector, await callFor(started.connectionId)))[0]?.type).toBe("result");
  });

  it("preserves legacy account access when the migration materializes explicit grants", async () => {
    const legacy = await handles.prisma.connection.create({
      data: {
        userId: context.userId,
        spaceId: context.spaceId,
        connectorId: "composio",
        provider: "GMAIL",
        displayName: "Legacy mail",
        status: "connected",
      },
    });
    const migration = await readFile(
      new URL(
        "../../db/prisma/migrations/20261116090000_direct_app_connections/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await handles.prisma.$executeRawUnsafe(
      migration.slice(migration.indexOf('INSERT INTO "bot_connections"')),
    );
    const grants = await handles.prisma.botConnection.findMany({
      where: { connectionId: legacy.id },
    });
    expect(grants.map((grant) => grant.botId)).toContain(ownBot.id);
    expect(grants.map((grant) => grant.botId)).not.toContain(foreignBot.id);
  });

  it("refreshes once across independent database clients and commits rotation even after a failed action", async () => {
    actionStatus = 500;
    const { started } = await connect();
    await rpc(cookie, "connections/setAgents", {
      connectionId: started.connectionId,
      botIds: [ownBot.id],
    });
    await changeSecret(started.connectionId, (state) => {
      state.tokens.expiresAt = Date.now() - 1;
    });
    const call = await callFor(started.connectionId);
    const otherDb = createDb(process.env.DATABASE_URL!, { poolMax: 2 });
    const otherProcess = new DirectAppConnector({
      prisma: otherDb.prisma,
      secrets,
      settings: {},
      identitySecret: IDENTITY,
      broker,
      fetch: fetcher as typeof fetch,
    });
    const refresh = vi.mocked(broker.refresh);
    refresh.mockClear();
    try {
      const results = await Promise.all([
        invoke(connector, call),
        invoke(otherProcess, { ...call, executionId: randomUUID() }),
      ]);
      expect(results.every((events) => events[0]?.type === "error")).toBe(true);
      expect(refresh).toHaveBeenCalledOnce();
      await changeSecret(started.connectionId, (state) => {
        expect(state.tokens.refreshToken).toBe("private-refresh-rotated");
        expect(state.tokens.brokerCredential).toBe("private-capability-rotated");
      });
      actionStatus = 200;
      expect((await invoke(otherProcess, call))[0]?.type).toBe("result");
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      actionStatus = 200;
      await otherDb.prisma.$disconnect();
      await otherDb.pool.end();
    }
  });

  it("serializes a grant revocation behind accepted work and rejects the captured old call afterward", async () => {
    const { started } = await connect();
    await rpc(cookie, "connections/setAgents", {
      connectionId: started.connectionId,
      botIds: [ownBot.id],
    });
    const queued = await callFor(started.connectionId);
    let accepted!: () => void;
    const entered = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    onAction = async () => {
      accepted();
      await released;
    };
    try {
      const running = invoke(connector, queued);
      await entered;
      const revoke = rpc(cookie, "connections/setAgents", {
        connectionId: started.connectionId,
        botIds: [],
      });
      release();
      expect((await running)[0]?.type).toBe("result");
      await revoke;
      const before = fetcher.mock.calls.length;
      expect((await invoke(connector, queued))[0]?.type).toBe("error");
      expect(fetcher.mock.calls).toHaveLength(before);
    } finally {
      onAction = undefined;
      release();
    }
  });

  it("rejects old workflow callbacks and old account tools after reconnecting to another account", async () => {
    const original = await connect();
    await rpc(cookie, "connections/setAgents", {
      connectionId: original.started.connectionId,
      botIds: [ownBot.id],
    });
    const oldCall = await callFor(original.started.connectionId);
    profile = "B";
    const newStart = await rpc<Started>(cookie, "connections/begin", {
      connectorId: "direct",
      provider: "google",
      displayName: "Workspace",
      connectionId: original.started.connectionId,
    });
    expect(
      (
        await request(cookie, "connections/complete", {
          connectionId: newStart.connectionId,
          authorizationId: original.started.authorizationId,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    await changeSecret(newStart.connectionId, (state) => {
      state.nextPollAt = 0;
    });
    const completed = await rpc<Connection>(cookie, "connections/complete", {
      connectionId: newStart.connectionId,
      authorizationId: newStart.authorizationId,
    });
    expect(completed).toMatchObject({ accountLabel: "b@example.test", agentIds: [] });
    await rpc(cookie, "connections/setAgents", {
      connectionId: newStart.connectionId,
      botIds: [ownBot.id],
    });
    const before = fetcher.mock.calls.length;
    expect((await invoke(connector, oldCall))[0]?.type).toBe("error");
    expect(fetcher.mock.calls).toHaveLength(before);
    await rpc(cookie, "connections/revoke", { connectionId: newStart.connectionId });
    expect(
      (await handles.prisma.connection.findUniqueOrThrow({ where: { id: newStart.connectionId } }))
        .secretId,
    ).toBeNull();
    expect((await invoke(connector, oldCall))[0]?.type).toBe("error");
    profile = "A";
  });
});
