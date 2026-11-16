import { afterEach, describe, expect, it, vi } from "vitest";
import { hash, randomSecret, unseal } from "./crypto.js";
import { ConnectSession, createWorker, SESSION_TTL_MS } from "./index.js";
import type { Env, SessionState, Tokens } from "./platform.js";

const ORIGIN = "https://connect.example.test";
class MemoryStorage {
  values = new Map<string, unknown>();
  alarm = 0;
  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.values.set(key, value);
  }
  async setAlarm(timestamp: number) {
    this.alarm = timestamp;
  }
  async deleteAll() {
    this.values.clear();
  }
}
function fixture() {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope: "read",
    }),
  );
  const objects = new Map<string, { object: ConnectSession; storage: MemoryStorage }>();
  const env: Env = {
    AUTH_START_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    TOKEN_REQUEST_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    PUBLIC_ORIGIN: ORIGIN,
    TOKEN_KEY: "11".repeat(32),
    PROVIDERS: JSON.stringify({
      google: { clientId: "google-client", clientSecret: "provider-private-secret" },
      slack: { clientId: "slack-client", clientSecret: "slack-private-secret" },
      notion: { clientId: "notion-client", clientSecret: "notion-private-secret" },
      linear: { clientId: "linear-client", clientSecret: "linear-private-secret" },
    }),
    PUBLIC_CLIENTS: JSON.stringify({
      githubClientId: "public-github",
      microsoftClientId: "public-microsoft",
    }),
    SESSIONS: {
      idFromName: (name) => name,
      get(id) {
        const key = String(id);
        let entry = objects.get(key);
        if (!entry) {
          const storage = new MemoryStorage();
          entry = {
            object: new ConnectSession({ storage } as SessionState, env, request),
            storage,
          };
          objects.set(key, entry);
        }
        return entry.object;
      },
    },
  };
  const worker = createWorker(request);
  const call = (path: string, body?: unknown, secret?: string) =>
    worker.fetch(
      new Request(
        `${ORIGIN}${path}`,
        body === undefined
          ? { headers: { "cf-connecting-ip": "203.0.113.10" } }
          : {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "cf-connecting-ip": "203.0.113.10",
                ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
              },
              body: JSON.stringify(body),
            },
      ),
      env,
    );
  async function begin(provider = "google") {
    const claimSecret = randomSecret();
    const state = randomSecret();
    const response = await call("/v1/authorizations", {
      provider,
      state,
      installationId: "installation-a",
      claimChallenge: await hash(claimSecret),
    });
    expect(response.status).toBe(200);
    const started = (await response.json()) as {
      sessionId: string;
      authorizationUrl: string;
      expiresAt: string;
    };
    const browserState = new URL(started.authorizationUrl).searchParams.get("state")!;
    return { ...started, claimSecret, state, browserState, provider };
  }
  async function authorize(provider = "google") {
    const session = await begin(provider);
    const callback = await call(
      `/oauth/callback/${provider}?state=${session.browserState}&code=private-code`,
    );
    expect(callback.status).toBe(200);
    const claimed = await call(
      `/v1/authorizations/${session.sessionId}`,
      { provider, state: session.state },
      session.claimSecret,
    );
    expect(claimed.status).toBe(200);
    return { session, tokens: (await claimed.json()) as Tokens };
  }
  return { env, objects, request, call, begin, authorize, worker };
}

afterEach(() => vi.useRealTimers());

describe("sign-in helper boundary", () => {
  it("advertises only configured providers/public client IDs and fixes callback origin and scopes", async () => {
    const test = fixture();
    test.env.PROVIDERS = JSON.stringify({
      google: { clientId: "client", clientSecret: "never-public" },
    });
    const catalog = await (await test.call("/v1/catalog")).json();
    expect(catalog).toEqual({
      providers: ["google"],
      publicClients: { githubClientId: "public-github", microsoftClientId: "public-microsoft" },
    });
    expect(JSON.stringify(catalog)).not.toContain("never-public");
    const started = await test.begin();
    const url = new URL(started.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/oauth/callback/google`);
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).not.toContain("gmail.modify");
    expect(
      (
        await test.call("/v1/authorizations", {
          provider: "google",
          state: randomSecret(),
          installationId: "a",
          claimChallenge: await hash(randomSecret()),
          tokenUrl: "https://attacker.test",
        })
      ).status,
    ).toBe(400);
    expect(
      (await test.worker.fetch(new Request("https://attacker.test/v1/catalog"), test.env)).status,
    ).toBe(404);
    expect(
      (
        await test.call("/v1/authorizations", {
          provider: "linear",
          state: randomSecret(),
          installationId: "a",
          claimChallenge: await hash(randomSecret()),
        })
      ).status,
    ).toBe(404);
  });
  it("requires the NAS secret and matching NAS state; browser state cannot claim tokens", async () => {
    const test = fixture();
    const session = await test.begin();
    const claim = `/v1/authorizations/${session.sessionId}`;
    expect(
      (await test.call(claim, { provider: "google", state: session.state }, randomSecret())).status,
    ).toBe(403);
    expect(
      (
        await test.call(
          claim,
          { provider: "google", state: session.browserState },
          session.claimSecret,
        )
      ).status,
    ).toBe(403);
    expect(
      (await test.call(claim, { provider: "slack", state: session.state }, session.claimSecret))
        .status,
    ).toBe(403);
    expect(
      (await test.call(claim, { provider: "google", state: session.state }, session.claimSecret))
        .status,
    ).toBe(202);
    expect(test.request).not.toHaveBeenCalled();
  });
  it("exchanges a code once under concurrent callbacks and keeps encrypted retryable results", async () => {
    const test = fixture();
    const session = await test.begin();
    const callback = `/oauth/callback/google?state=${session.browserState}&code=secret-code`;
    const results = await Promise.all([test.call(callback), test.call(callback)]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(test.request).toHaveBeenCalledOnce();
    const wrongNonce = `${session.sessionId}.${randomSecret()}`;
    expect((await test.call(`/oauth/callback/google?state=${wrongNonce}&code=bad`)).status).toBe(
      400,
    );
    expect(test.request).toHaveBeenCalledOnce();
    const claim = () =>
      test.call(
        `/v1/authorizations/${session.sessionId}`,
        { provider: "google", state: session.state },
        session.claimSecret,
      );
    const first = (await (await claim()).json()) as Tokens;
    const retry = await (await claim()).json();
    expect(first.accessToken).toBe("access-secret");
    expect(first.brokerCredential).toBeTruthy();
    expect(retry).toEqual(first);
    const stored = test.objects.get(session.sessionId)!.storage;
    expect(JSON.stringify([...stored.values.values()])).not.toContain("access-secret");
    expect(JSON.stringify([...stored.values.values()])).not.toContain("secret-code");
    expect(JSON.stringify([...stored.values.values()])).not.toContain(session.claimSecret);
    const clear = await unseal<{ tokens: Tokens }>(
      test.env.TOKEN_KEY,
      stored.values.get("session") as string,
    );
    expect(clear.tokens.accessToken).toBe("access-secret");
    expect(stored.alarm).toBe(Date.parse(session.expiresAt));
  });
  it("does not exchange mismatched/denied callbacks and purges sessions after TTL", async () => {
    vi.useFakeTimers();
    const test = fixture();
    const session = await test.begin();
    expect(
      (await test.call(`/oauth/callback/slack?state=${session.browserState}&code=wrong-provider`))
        .status,
    ).toBe(400);
    expect(test.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SESSION_TTL_MS + 1);
    await test.objects.get(session.sessionId)!.object.alarm();
    expect(test.objects.get(session.sessionId)!.storage.values.size).toBe(0);
    expect(
      (
        await test.call(
          `/v1/authorizations/${session.sessionId}`,
          { provider: "google", state: session.state },
          session.claimSecret,
        )
      ).status,
    ).toBe(404);
    const denied = await test.begin();
    expect(
      (
        await test.call(
          `/oauth/callback/google?state=${denied.browserState}&error=secret-provider-error`,
        )
      ).status,
    ).toBe(400);
    expect(test.request).not.toHaveBeenCalled();
  });
  it("never echoes provider errors, callback codes, request bodies, or credentials", async () => {
    const test = fixture();
    const session = await test.begin();
    test.request.mockResolvedValue(
      Response.json(
        { error: "provider-private-secret secret-code access-secret" },
        { status: 400 },
      ),
    );
    const callback = await test.call(
      `/oauth/callback/google?state=${session.browserState}&code=secret-code`,
    );
    expect(await callback.text()).not.toMatch(/provider-private-secret|secret-code|access-secret/);
    const result = await test.call(
      `/v1/authorizations/${session.sessionId}`,
      { provider: "google", state: session.state },
      session.claimSecret,
    );
    expect(result.status).toBe(409);
    expect(await result.text()).not.toMatch(/provider-private-secret|secret-code|access-secret/);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
});

describe("anonymous admission limits", () => {
  it("limits starts before creating sessions and does not let rotating request fields bypass the source allowance", async () => {
    const test = fixture();
    const limit = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValue({ success: false });
    test.env.AUTH_START_LIMITER.limit = limit;
    const first = await test.begin();
    const denied = await test.call("/v1/authorizations", {
      provider: "slack",
      state: randomSecret(),
      installationId: "different-installation",
      claimChallenge: await hash(randomSecret()),
    });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(test.objects.size).toBe(1);
    expect(test.request).not.toHaveBeenCalled();
    expect(limit.mock.calls[0]![0]).toEqual(limit.mock.calls[1]![0]);
    expect(JSON.stringify(limit.mock.calls)).not.toContain("203.0.113.10");
    expect(JSON.stringify(limit.mock.calls)).not.toContain(first.claimSecret);
  });
  it("rejects blocked token traffic before capability verification, provider requests or Durable Object allocation", async () => {
    const test = fixture();
    test.env.TOKEN_REQUEST_LIMITER.limit = vi.fn(async () => ({ success: false }));
    const refresh = await test.call("/v1/refresh", {
      provider: "google",
      refreshToken: "untrusted-token",
      brokerCredential: "invalid",
    });
    const revoke = await test.call("/v1/revoke", {
      provider: "google",
      accessToken: "untrusted-token",
      brokerCredential: "invalid",
    });
    expect(refresh.status).toBe(429);
    expect(revoke.status).toBe(429);
    expect(test.objects.size).toBe(0);
    expect(test.request).not.toHaveBeenCalled();
  });
  it("refuses invalid refresh capabilities before allocating a Durable Object even below the rate limit", async () => {
    const test = fixture();
    const denied = await test.call("/v1/refresh", {
      provider: "google",
      refreshToken: "untrusted-token",
      brokerCredential: "invalid",
    });
    expect(denied.status).toBe(403);
    expect(test.objects.size).toBe(0);
    expect(test.request).not.toHaveBeenCalled();
  });
  it("fails closed when a deployment loses its limiter binding or trusted edge address", async () => {
    const test = fixture();
    test.env.AUTH_START_LIMITER.limit = vi.fn(async () => {
      throw new Error("private infrastructure error");
    });
    const body = {
      provider: "google",
      state: randomSecret(),
      installationId: "installation",
      claimChallenge: await hash(randomSecret()),
    };
    const unavailable = await test.call("/v1/authorizations", body);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private infrastructure error");
    const missingAddress = await test.worker.fetch(
      new Request(`${ORIGIN}/v1/authorizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.10" },
        body: JSON.stringify(body),
      }),
      test.env,
    );
    expect(missingAddress.status).toBe(503);
    expect(test.objects.size).toBe(0);
    expect(test.request).not.toHaveBeenCalled();
  });
});

describe("fixed provider OAuth requests", () => {
  it("requests a Slack user scope and returns the user token rather than an unrelated bot token", async () => {
    const test = fixture();
    test.request.mockImplementation(async () =>
      Response.json({
        ok: true,
        access_token: "bot-token-not-for-this-account",
        authed_user: {
          access_token: "user-access",
          refresh_token: "user-refresh",
          scope: "search:read",
          token_type: "user",
        },
      }),
    );
    const { session, tokens } = await test.authorize("slack");
    const url = new URL(session.authorizationUrl);
    expect(url.searchParams.get("user_scope")).toBe("search:read");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(tokens.accessToken).toBe("user-access");
    expect(JSON.stringify(tokens)).not.toContain("bot-token");
    expect(test.request.mock.calls[0]![0]).toBe("https://slack.com/api/oauth.v2.access");
  });
  it("uses Notion's JSON/basic-auth token exchange and does not claim unsupported remote revocation", async () => {
    const test = fixture();
    const { tokens } = await test.authorize("notion");
    const [url, init] = test.request.mock.calls[0]!;
    expect(url).toBe("https://api.notion.com/v1/oauth/token");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${btoa("notion-client:notion-private-secret")}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      grant_type: "authorization_code",
      redirect_uri: `${ORIGIN}/oauth/callback/notion`,
    });
    test.request.mockClear();
    const result = await test.call("/v1/revoke", {
      provider: "notion",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      brokerCredential: tokens.brokerCredential,
    });
    expect(await result.json()).toEqual({ revoked: false });
    expect(test.request).not.toHaveBeenCalled();
  });
  it("keeps Linear read-only and ignores provider token/error fields outside the token DTO", async () => {
    const test = fixture();
    test.request.mockImplementation(async () =>
      Response.json({
        access_token: "linear-access",
        refresh_token: "linear-refresh",
        scope: "read",
        workspace_name: "not-retained",
        owner: { email: "not-retained" },
      }),
    );
    const { session, tokens } = await test.authorize("linear");
    const url = new URL(session.authorizationUrl);
    expect(url.searchParams.get("scope")).toBe("read");
    expect(test.request.mock.calls[0]![0]).toBe("https://api.linear.app/oauth/token");
    expect(JSON.stringify(tokens)).not.toContain("not-retained");
  });
});

describe("renewal and revocation capabilities", () => {
  it("rejects token substitution, wrong providers and unsigned refresh requests without contacting providers", async () => {
    const test = fixture();
    const { tokens } = await test.authorize();
    test.request.mockClear();
    expect(
      (await test.call("/v1/refresh", { provider: "google", refreshToken: "refresh-secret" }))
        .status,
    ).toBe(400);
    expect(
      (
        await test.call("/v1/refresh", {
          provider: "google",
          refreshToken: "other-token",
          brokerCredential: tokens.brokerCredential,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await test.call("/v1/refresh", {
          provider: "linear",
          refreshToken: "refresh-secret",
          brokerCredential: tokens.brokerCredential,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await test.call("/v1/revoke", {
          provider: "google",
          accessToken: "different-token",
          brokerCredential: tokens.brokerCredential,
        })
      ).status,
    ).toBe(403);
    expect(test.request).not.toHaveBeenCalled();
  });
  it("serializes rotating refreshes, caches lost responses, and issues a capability for the replacement", async () => {
    const test = fixture();
    const { tokens } = await test.authorize();
    test.request.mockClear();
    test.request.mockResolvedValue(
      Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    );
    const body = {
      provider: "google",
      refreshToken: tokens.refreshToken,
      brokerCredential: tokens.brokerCredential,
    };
    const result = await Promise.all([
      test.call("/v1/refresh", body),
      test.call("/v1/refresh", body),
    ]);
    const first = (await result[0]!.json()) as Tokens;
    const second = await result[1]!.json();
    expect(first.accessToken).toBe("new-access");
    expect(second).toEqual(first);
    expect(first.brokerCredential).not.toBe(tokens.brokerCredential);
    expect(test.request).toHaveBeenCalledOnce();
    test.request.mockImplementation(async () =>
      Response.json({ access_token: "third-access", refresh_token: "third-refresh" }),
    );
    expect(
      (
        await test.call("/v1/refresh", {
          provider: "google",
          refreshToken: first.refreshToken,
          brokerCredential: first.brokerCredential,
        })
      ).status,
    ).toBe(200);
    const cached = [...test.objects.entries()].find(([id]) => id.startsWith("refresh:"))![1]
      .storage;
    expect(JSON.stringify([...cached.values.values()])).not.toContain("new-access");
  });
  it("revokes only the capability's account through a fixed provider endpoint", async () => {
    const test = fixture();
    const { tokens } = await test.authorize();
    test.request.mockClear();
    test.request.mockResolvedValue(new Response(null, { status: 200 }));
    const revoked = await test.call("/v1/revoke", {
      provider: "google",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      brokerCredential: tokens.brokerCredential,
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });
    expect(test.request).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({ method: "POST", body: "token=refresh-secret", redirect: "error" }),
    );
  });
});
