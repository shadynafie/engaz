import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@engaz/adapter-kit";
import type { PrismaClient } from "@engaz/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectorStack } from "./composio-connector.js";
import { DirectAppConnector } from "./direct-app-connector.js";
import type { DirectAppBroker, DirectAppTokens } from "./direct-app-types.js";
import { EncryptedSecretStore } from "./secrets.js";

const context: AdapterContext = {
  userId: "owner",
  spaceId: "space",
  botId: "agent",
  operationId: "test",
  traceId: "test",
  signal: new AbortController().signal,
};
const json = (data: unknown, status = 200) => Response.json(data, { status });
afterEach(() => vi.useRealTimers());

function fixture() {
  let row: Record<string, any> | null = null;
  let grants: Array<Record<string, string>> = [];
  let secrets = new Map<string, Record<string, any>>();
  let tail = Promise.resolve();
  const result = (): Record<string, any> | null =>
    row ? structuredClone({ ...row, botConnections: grants }) : null;
  const matches = (where: Record<string, any>) =>
    Boolean(
      row &&
        Object.entries(where).every(([key, value]) => {
          if (["id", "userId", "spaceId", "connectorId", "provider", "revision"].includes(key))
            return row![key] === value;
          if (key === "status")
            return typeof value === "string" ? row!.status === value : row!.status !== value.not;
          if (key === "checkedAt") return row!.checkedAt !== null;
          if (key === "botConnections")
            return grants.some((grant) => grant.botId === value.some.botId);
          if (key === "metadata") return row!.metadata[value.path[0]] === value.equals;
          return true;
        }),
    );
  const update = (data: Record<string, any>) => {
    for (const [key, value] of Object.entries(data))
      row![key] = key === "revision" ? row!.revision + value.increment : structuredClone(value);
  };
  const db: any = {
    $queryRaw: vi.fn(),
    connection: {
      create: vi.fn(async ({ data }) => {
        row = {
          id: "account",
          revision: 0,
          secretId: null,
          providerRef: null,
          metadata: {},
          accountLabel: null,
          checkedAt: null,
          createdAt: new Date(),
          ...data,
        };
        return result();
      }),
      findFirst: vi.fn(async ({ where }) => (matches(where) ? result() : null)),
      findMany: vi.fn(async ({ where }) => (matches(where) ? [result()] : [])),
      update: vi.fn(async ({ data }) => {
        update(data);
        return result();
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        update(data);
        return { count: 1 };
      }),
    },
    secret: {
      create: vi.fn(async ({ data }) => {
        secrets.set(data.id, structuredClone(data));
        return data;
      }),
      findFirst: vi.fn(async ({ where }) => {
        const secret = secrets.get(where.id);
        return secret &&
          secret.userId === where.userId &&
          secret.spaceId === where.spaceId &&
          secret.kind === where.kind
          ? secret
          : null;
      }),
      deleteMany: vi.fn(async ({ where }) => {
        secrets.delete(where.id);
        return { count: 1 };
      }),
    },
    botConnection: {
      deleteMany: vi.fn(async () => {
        grants = [];
        return { count: 1 };
      }),
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = {
        row: structuredClone(row),
        grants: structuredClone(grants),
        secrets: structuredClone(secrets),
      };
      try {
        return await fn(db);
      } catch (error) {
        row = snapshot.row;
        grants = snapshot.grants;
        secrets = snapshot.secrets;
        throw error;
      } finally {
        release();
      }
    },
  };
  const secretStore = new EncryptedSecretStore("offline-direct-connection-encryption-key");
  return {
    db,
    prisma: db as PrismaClient,
    secretStore,
    row: () => result()!,
    grant: () => {
      grants = [{ connectionId: "account", botId: "agent", userId: "owner", spaceId: "space" }];
    },
    state: () => {
      const secret = secrets.get(row!.secretId)!;
      return JSON.parse(secretStore.load(secret.ciphertext, secret.id));
    },
    encrypted: () => JSON.stringify([...secrets.values()]),
  };
}

function brokerFixture() {
  const f = fixture();
  let profile = "Account A";
  const tokens: DirectAppTokens = {
    accessToken: "private-access-old",
    refreshToken: "private-refresh-old",
    expiresAt: Date.now() + 60 * 60_000,
    brokerCredential: "private-broker-old",
  };
  const broker: DirectAppBroker = {
    available: () => true,
    begin: vi.fn(async () => ({
      authorizationUrl: "https://connect.example.test/sign-in",
      sessionId: "private-session-credential",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    })),
    complete: vi.fn(async () => tokens),
    refresh: vi.fn(async () => ({
      accessToken: "private-access-new",
      refreshToken: "private-refresh-new",
      brokerCredential: "private-broker-new",
      expiresAt: Date.now() + 3600_000,
    })),
    revoke: vi.fn(async () => undefined),
  };
  const fetcher = vi.fn(async (url) =>
    String(url).includes("userinfo")
      ? json({ sub: profile, email: `${profile.replaceAll(" ", "-")}@example.test` })
      : json({ files: [{ id: "file-1", name: "Report" }] }),
  );
  const connector = new DirectAppConnector({
    prisma: f.prisma,
    secrets: f.secretStore,
    identitySecret: "installation-secret",
    settings: {},
    broker,
    fetch: fetcher as typeof fetch,
  });
  async function connect(connectionId?: string) {
    const started = await connector.beginConnection(
      {
        provider: "google",
        displayName: "Workspace",
        redirectUrl: "https://app.example.test/app",
        connectionId,
      },
      context,
    );
    vi.setSystemTime(Date.now() + 2100);
    const completed = await connector.completeConnection(
      started.connectionId,
      started.authorizationId,
      context,
    );
    return { started, completed };
  }
  return {
    ...f,
    connector,
    broker,
    tokens,
    fetcher,
    connect,
    changeProfile: () => {
      profile = "Account B";
    },
  };
}
async function invoke(connector: ConnectorProvider, call: ConnectorCall) {
  const events = [];
  for await (const event of connector.execute(call, context)) events.push(event);
  return events;
}

describe("direct app connections", () => {
  it("keeps pending credentials encrypted, honors device polling, and verifies the actual account", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let tokenCalls = 0;
    const fetcher = vi.fn(async (url) => {
      if (String(url).endsWith("/device/code"))
        return json({
          device_code: "private-device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      if (String(url).endsWith("/access_token"))
        return ++tokenCalls === 1
          ? json({ error: "authorization_pending" })
          : json({ access_token: "private-access-token", token_type: "Bearer" });
      return json({ id: 42, login: "test-account" });
    });
    const connector = new DirectAppConnector({
      prisma: f.prisma,
      secrets: f.secretStore,
      settings: { githubClientId: "maintainer-public-client-id" },
      identitySecret: "installation-secret",
      fetch: fetcher as typeof fetch,
    });
    const started = await connector.beginConnection(
      { provider: "github", displayName: "Code", redirectUrl: "https://app.example.test/app" },
      context,
    );
    expect(started).toMatchObject({ userCode: "ABCD-EFGH", pollIntervalSeconds: 5 });
    expect(JSON.stringify(started)).not.toContain("private-device-code");
    expect(f.encrypted()).not.toContain("private-device-code");
    expect(
      (await connector.completeConnection(started.connectionId, started.authorizationId, context))
        .status,
    ).toBe("pending");
    expect(tokenCalls).toBe(0);
    vi.setSystemTime(Date.now() + 6000);
    expect(
      (await connector.completeConnection(started.connectionId, started.authorizationId, context))
        .status,
    ).toBe("pending");
    expect(tokenCalls).toBe(1);
    vi.setSystemTime(Date.now() + 6000);
    const connected = await connector.completeConnection(
      started.connectionId,
      started.authorizationId,
      context,
    );
    expect(connected).toMatchObject({
      status: "connected",
      accountLabel: "test-account",
      agentIds: [],
    });
    expect(connected.checkedAt).not.toBeNull();
    expect(JSON.stringify(connected)).not.toContain("private-access-token");
    expect(await connector.discoverTools(context)).toEqual([]);
  });
  it("binds sign-in to the owner, installation, active workflow, and expiry", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    const started = await f.connector.beginConnection(
      { provider: "google", displayName: "Work", redirectUrl: "https://app.example.test/app" },
      context,
    );
    expect(JSON.stringify(started)).not.toContain("private-session-credential");
    await expect(
      f.connector.completeConnection(started.connectionId, "old-workflow", context),
    ).rejects.toThrow("no longer active");
    await expect(
      f.connector.completeConnection(started.connectionId, started.authorizationId, {
        ...context,
        userId: "other",
      }),
    ).rejects.toThrow("no longer active");
    expect(f.broker.complete).not.toHaveBeenCalled();
    expect(f.row().status).toBe("pending");
    vi.setSystemTime(Date.now() + 901_000);
    await expect(
      f.connector.completeConnection(started.connectionId, started.authorizationId, context),
    ).rejects.toThrow("Connect again");
    expect(f.row().status).toBe("error");
  });
  it("does not resurrect a revoked pending sign-in", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    const started = await f.connector.beginConnection(
      { provider: "google", displayName: "Work", redirectUrl: "https://app.example.test/app" },
      context,
    );
    await f.connector.revokeConnection(started.connectionId, context);
    await expect(
      f.connector.completeConnection(started.connectionId, started.authorizationId, context),
    ).rejects.toThrow("no longer active");
    expect(f.row()).toMatchObject({ status: "revoked", secretId: null });
    expect(f.broker.complete).not.toHaveBeenCalled();
  });
  it("resolves and executes discovered actions through the real registry without weakening grants", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    await f.connect();
    f.grant();
    const { connector } = createConnectorStack(false, undefined, [f.connector]);
    const tool = (await connector.discoverTools(context)).find(
      (item) => item.route?.connectorId === "direct",
    )!;
    const call = {
      tool: tool.name,
      route: tool.route,
      args: { limit: 5 },
      executionId: "registry",
    };
    const resolved = await connector.resolveCall(call, context);
    expect(resolved?.tool.name).toBe(tool.name);
    expect((await invoke(connector, resolved!.call))[0]?.type).toBe("result");
    const calls = f.fetcher.mock.calls.length;
    expect(
      (
        await invoke(connector, {
          ...call,
          route: { ...call.route!, resourceRevision: "stale-generation" },
        })
      )[0]?.type,
    ).toBe("error");
    await f.connector.revokeConnection("account", context);
    expect(await connector.resolveCall(call, context)).toBeUndefined();
    expect((await invoke(connector, call))[0]?.type).toBe("error");
    expect(f.fetcher.mock.calls).toHaveLength(calls);
  });
  it("requires current grants and rejects changed-action arguments before provider access", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    await f.connect();
    f.grant();
    const [tool] = await f.connector.discoverTools(context);
    const call = { tool: tool!.name, route: tool!.route, args: { limit: 5 }, executionId: "call" };
    expect((await invoke(f.connector, call))[0]?.type).toBe("result");
    const calls = f.fetcher.mock.calls.length;
    expect(
      (await invoke(f.connector, { ...call, args: { url: "http://127.0.0.1/private" } }))[0]?.type,
    ).toBe("error");
    expect(f.fetcher.mock.calls).toHaveLength(calls);
    await f.connector.revokeConnection("account", context);
    expect((await invoke(f.connector, call))[0]?.type).toBe("error");
    expect(f.fetcher.mock.calls).toHaveLength(calls);
  });
  it("fences an old call after reauthorization to another account", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    await f.connect();
    f.grant();
    const [old] = await f.connector.discoverTools(context);
    f.changeProfile();
    await f.connect("account");
    expect(f.row().botConnections).toEqual([]);
    f.grant();
    const [current] = await f.connector.discoverTools(context);
    expect(current!.name).not.toBe(old!.name);
    const call = { tool: old!.name, route: old!.route, args: { limit: 5 }, executionId: "old" };
    const calls = f.fetcher.mock.calls.length;
    expect(await f.connector.resolveCall(call, context)).toBeUndefined();
    expect((await invoke(f.connector, call))[0]?.type).toBe("error");
    expect(f.fetcher.mock.calls).toHaveLength(calls);
  });
  it("serializes rotating refresh and retains renewed credentials when the action fails", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    f.tokens.expiresAt = Date.now() + 10_000;
    await f.connect();
    f.grant();
    const [tool] = await f.connector.discoverTools(context);
    const call = {
      tool: tool!.name,
      route: tool!.route,
      args: { limit: 5 },
      executionId: "refresh",
    };
    f.fetcher.mockImplementation(async (url) =>
      String(url).includes("userinfo")
        ? json({ sub: "a", email: "a@example.test" })
        : json({ error: "temporary" }, 500),
    );
    const outcomes = await Promise.all([
      invoke(f.connector, call),
      invoke(f.connector, { ...call, executionId: "parallel" }),
    ]);
    expect(outcomes.every((events) => events[0]?.type === "error")).toBe(true);
    expect(f.broker.refresh).toHaveBeenCalledOnce();
    expect(f.state().tokens).toMatchObject({
      refreshToken: "private-refresh-new",
      brokerCredential: "private-broker-new",
    });
    expect(f.row().status).toBe("connected");
    f.fetcher.mockImplementation(async () => json({ files: [] }));
    expect((await invoke(f.connector, call))[0]?.type).toBe("result");
    expect(f.broker.refresh).toHaveBeenCalledOnce();
  });
  it("redacts old and renewed credentials from provider values, arrays, keys, and account labels", async () => {
    vi.useFakeTimers();
    const f = brokerFixture();
    f.tokens.expiresAt = Date.now() + 10_000;
    f.fetcher.mockImplementation(async (url) =>
      String(url).includes("userinfo")
        ? json({ sub: "safe-account", email: `Owner ${f.tokens.accessToken}` })
        : json({
            [f.tokens.accessToken]: [f.tokens.refreshToken, f.tokens.brokerCredential],
            echo: "private-access-new private-refresh-new private-broker-new",
            normal: "Bearer",
          }),
    );
    const connected = await f.connect();
    expect(connected.completed.accountLabel).not.toContain(f.tokens.accessToken);
    f.grant();
    const [tool] = await f.connector.discoverTools(context);
    const result = await invoke(f.connector, {
      tool: tool!.name,
      route: tool!.route,
      args: { limit: 5 },
      executionId: "redacted",
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "private-access-old",
      "private-refresh-old",
      "private-broker-old",
      "private-access-new",
      "private-refresh-new",
      "private-broker-new",
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).toContain("Bearer");
    expect(serialized).toContain("[redacted]");
  });
  it("renews a native account after restart even when client registration discovery is unavailable", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const fetcher = vi.fn(async (url, request?: RequestInit) => {
      if (String(url).endsWith("/device/code"))
        return json({
          device_code: "private-device",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      if (String(url).endsWith("/access_token")) {
        const form = new URLSearchParams(String(request?.body));
        expect(form.get("client_id")).toBe("maintainer-client-id");
        return form.get("grant_type") === "refresh_token"
          ? json({
              access_token: "private-renewed",
              refresh_token: "private-refresh-renewed",
              expires_in: 3600,
            })
          : json({
              access_token: "private-initial",
              refresh_token: "private-refresh-initial",
              expires_in: 120,
            });
      }
      if (String(url).endsWith("/user")) return json({ id: 42, login: "example-reader" });
      return json([{ id: 1, name: "example-repository" }]);
    });
    const initial = new DirectAppConnector({
      prisma: f.prisma,
      secrets: f.secretStore,
      settings: { githubClientId: "maintainer-client-id" },
      identitySecret: "installation-secret",
      fetch: fetcher as typeof fetch,
    });
    const started = await initial.beginConnection(
      { provider: "github", displayName: "Code", redirectUrl: "https://app.example.test/app" },
      context,
    );
    vi.setSystemTime(Date.now() + 6000);
    await initial.completeConnection(started.connectionId, started.authorizationId, context);
    expect(f.state().clientId).toBe("maintainer-client-id");
    f.grant();
    const [tool] = await initial.discoverTools(context);
    vi.setSystemTime(Date.now() + 180_000);
    const restarted = new DirectAppConnector({
      prisma: f.prisma,
      secrets: f.secretStore,
      settings: {},
      identitySecret: "installation-secret",
      fetch: fetcher as typeof fetch,
    });
    const result = await invoke(restarted, {
      tool: tool!.name,
      route: tool!.route,
      args: { limit: 3 },
      executionId: "after-restart",
    });
    expect(result[0]?.type).toBe("result");
    expect(f.state().tokens.refreshToken).toBe("private-refresh-renewed");
  });
});
