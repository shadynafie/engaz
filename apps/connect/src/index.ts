import {
  equalSecret,
  hash,
  issueCapability,
  randomSecret,
  seal,
  unseal,
  validateTokenKey,
  verifyCapability,
} from "./crypto.js";
import type { Env, Provider, SessionState, Tokens } from "./platform.js";
import {
  authorizationUrl,
  boundedJson,
  clients,
  exchangeCode,
  provider,
  publicOrigin,
  refreshTokens,
  revokeTokens,
} from "./providers.js";

export type { Env } from "./platform.js";
export const SESSION_TTL_MS = 10 * 60_000;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: SECURITY_HEADERS });
}
function page(ok: boolean): Response {
  return new Response(
    ok
      ? "Sign-in complete. Return to Engaz."
      : "Sign-in could not finish. Return to Engaz and try again.",
    {
      status: ok ? 200 : 400,
      headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" },
    },
  );
}
function failure(status = 400) {
  return json({ error: "Connection request could not finish. Try again." }, status);
}
async function admission(request: Request, env: Env, start: boolean): Promise<Response | null> {
  // Anonymous requests have no verified account identity; caller-supplied installation IDs are rotatable.
  const address = request.headers.get("cf-connecting-ip");
  if (!address || address.length > 64) return failure(503);
  try {
    const limiter = start ? env.AUTH_START_LIMITER : env.TOKEN_REQUEST_LIMITER;
    const result = await limiter.limit({ key: await hash(`engaz-connect:${address}`) });
    if (result.success) return null;
    return Response.json(
      { error: "Too many connection requests. Try again shortly." },
      {
        status: 429,
        headers: { ...SECURITY_HEADERS, "retry-after": "60" },
      },
    );
  } catch {
    return failure(503);
  }
}
function string(value: unknown, min = 1, max = 32_768): string {
  if (typeof value !== "string" || value.length < min || value.length > max)
    throw new Error("Invalid field");
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown field");
}
function stub(env: Env, id: string) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(id));
}
function internal(env: Env, path: string, body: unknown, authorization?: string) {
  return new Request(`${publicOrigin(env)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
}
interface AuthorizationRecord {
  kind: "authorization";
  provider: Provider;
  state: string;
  installationId: string;
  claimChallenge: string;
  nonce: string;
  expiresAt: number;
  status: "pending" | "exchanging" | "done" | "failed";
  tokens?: Tokens;
}
interface RefreshRecord {
  kind: "refresh";
  provider: Provider;
  expiresAt: number;
  tokens: Tokens;
}
type StoredRecord = AuthorizationRecord | RefreshRecord;

/** A session contains only encrypted, short-lived sign-in material, never application API data. */
export class ConnectSession {
  private running: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly state: SessionState,
    private readonly env: Env,
    private readonly request: typeof fetch = fetch,
  ) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.running.then(action);
    this.running = result.catch(() => undefined);
    return result;
  }
  fetch(request: Request): Promise<Response> {
    return this.serialize(async () => {
      try {
        return await this.handle(request);
      } catch {
        return failure();
      }
    });
  }
  alarm(): Promise<void> {
    return this.serialize(async () => {
      const value = await this.read();
      if (value) await this.state.storage.setAlarm(value.expiresAt);
    });
  }
  private async read(): Promise<StoredRecord | undefined> {
    const encrypted = await this.state.storage.get<string>("session");
    if (!encrypted) return undefined;
    const value = await unseal<StoredRecord>(this.env.TOKEN_KEY, encrypted);
    if (value.expiresAt <= Date.now()) {
      await this.state.storage.deleteAll();
      return undefined;
    }
    return value;
  }
  private async save(value: StoredRecord) {
    await this.state.storage.put("session", await seal(this.env.TOKEN_KEY, value));
    await this.state.storage.setAlarm(value.expiresAt);
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await boundedJson(request);
    if (path === "/internal/initialize") {
      if (await this.read()) return failure(409);
      const name = provider(body.provider);
      const value: AuthorizationRecord = {
        kind: "authorization",
        provider: name,
        state: string(body.state, 16, 256),
        installationId: string(body.installationId, 1, 256),
        claimChallenge: string(body.claimChallenge, 43, 43),
        nonce: string(body.nonce, 43, 43),
        expiresAt: Date.now() + SESSION_TTL_MS,
        status: "pending",
      };
      await this.save(value);
      return json({ expiresAt: new Date(value.expiresAt).toISOString() });
    }
    if (path === "/internal/callback") {
      const value = await this.read();
      if (
        value?.kind !== "authorization" ||
        value.provider !== body.provider ||
        !equalSecret(value.nonce, string(body.nonce, 43, 43))
      )
        return page(false);
      if (value.status === "done") return page(true);
      if (value.status !== "pending") return page(false);
      if (body.denied === true) {
        value.status = "failed";
        await this.save(value);
        return page(false);
      }
      const code = string(body.code, 1, 8192);
      // Persist the one-use claim before the provider request; a restart cannot replay the code.
      value.status = "exchanging";
      await this.save(value);
      try {
        const result = await exchangeCode(this.env, value.provider, code, this.request);
        if (value.expiresAt <= Date.now()) {
          await this.state.storage.deleteAll();
          await revokeTokens(value.provider, result, this.request).catch(() => undefined);
          return page(false);
        }
        result.brokerCredential = await issueCapability(
          this.env.TOKEN_KEY,
          publicOrigin(this.env),
          value.provider,
          result,
        );
        value.tokens = result;
        value.status = "done";
      } catch {
        value.status = "failed";
      }
      await this.save(value);
      return page(value.status === "done");
    }
    if (path === "/internal/claim") {
      const value = await this.read();
      if (value?.kind !== "authorization") return failure(404);
      const secret = request.headers
        .get("authorization")
        ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if (
        !secret ||
        !equalSecret(await hash(secret), value.claimChallenge) ||
        value.provider !== body.provider ||
        !equalSecret(value.state, string(body.state, 16, 256))
      )
        return failure(403);
      if (value.status === "failed") return failure(409);
      // Retryable until TTL: a lost HTTP response cannot strand the NAS after a successful sign-in.
      return value.status === "done" && value.tokens
        ? json(value.tokens)
        : json({ pending: true }, 202);
    }
    if (path === "/internal/refresh") {
      const name = provider(body.provider);
      const refreshToken = string(body.refreshToken);
      if (
        !(await verifyCapability(
          this.env.TOKEN_KEY,
          publicOrigin(this.env),
          name,
          string(body.brokerCredential, 1, 8192),
          { refreshToken },
          "refresh",
        ))
      )
        return failure(403);
      const cached = await this.read();
      if (cached?.kind === "refresh" && cached.provider === name) return json(cached.tokens);
      const result = await refreshTokens(this.env, name, refreshToken, this.request);
      result.brokerCredential = await issueCapability(
        this.env.TOKEN_KEY,
        publicOrigin(this.env),
        name,
        result,
      );
      await this.save({
        kind: "refresh",
        provider: name,
        expiresAt: Date.now() + SESSION_TTL_MS,
        tokens: result,
      });
      return json(result);
    }
    return failure(404);
  }
}

export function createWorker(request: typeof fetch = fetch) {
  return {
    async fetch(input: Request, env: Env): Promise<Response> {
      try {
        const origin = publicOrigin(env);
        const url = new URL(input.url);
        // Never build a redirect or callback using an untrusted request host.
        if (url.origin !== origin) return failure(404);
        const starting = input.method === "POST" && url.pathname === "/v1/authorizations";
        const sessionRequest =
          (input.method === "POST" &&
            /^\/v1\/(?:authorizations\/[A-Za-z0-9_-]{43}|refresh|revoke)$/.test(url.pathname)) ||
          (input.method === "GET" && /^\/oauth\/callback\/[a-z]+$/.test(url.pathname));
        if (starting || sessionRequest) {
          const denied = await admission(input, env, starting);
          if (denied) return denied;
        }
        await validateTokenKey(env.TOKEN_KEY);
        const configured = clients(env);
        if (input.method === "GET" && url.pathname === "/v1/catalog") {
          const source = JSON.parse(env.PUBLIC_CLIENTS ?? "{}") as Record<string, unknown>;
          const publicClients: Record<string, string> = {};
          for (const name of ["githubClientId", "microsoftClientId"]) {
            if (source[name] !== undefined) publicClients[name] = string(source[name], 1, 256);
          }
          return json({ providers: Object.keys(configured), publicClients });
        }
        if (input.method === "POST" && url.pathname === "/v1/authorizations") {
          const body = await boundedJson(input, 8192);
          fields(body, ["provider", "state", "installationId", "claimChallenge"]);
          const name = provider(body.provider);
          if (!configured[name]) return failure(404);
          string(body.state, 16, 256);
          string(body.installationId, 1, 256);
          if (!SESSION_ID.test(string(body.claimChallenge, 43, 43))) return failure();
          const sessionId = randomSecret();
          const nonce = randomSecret();
          const result = await stub(env, sessionId).fetch(
            internal(env, "/internal/initialize", { ...body, nonce }),
          );
          if (!result.ok) return failure();
          const saved = await boundedJson(result);
          return json({
            sessionId,
            authorizationUrl: authorizationUrl(env, name, `${sessionId}.${nonce}`),
            expiresAt: saved.expiresAt,
          });
        }
        const callback = /^\/oauth\/callback\/([a-z]+)$/.exec(url.pathname);
        if (input.method === "GET" && callback) {
          const name = provider(callback[1]);
          if (!configured[name]) return page(false);
          const [sessionId, nonce, extra] = (url.searchParams.get("state") ?? "").split(".");
          if (
            !sessionId ||
            !nonce ||
            extra ||
            !SESSION_ID.test(sessionId) ||
            !SESSION_ID.test(nonce)
          )
            return page(false);
          return stub(env, sessionId).fetch(
            internal(env, "/internal/callback", {
              provider: name,
              nonce,
              code: url.searchParams.get("code"),
              denied: url.searchParams.has("error"),
            }),
          );
        }
        const claim = /^\/v1\/authorizations\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
        if (input.method === "POST" && claim) {
          const body = await boundedJson(input, 8192);
          fields(body, ["provider", "state"]);
          provider(body.provider);
          string(body.state, 16, 256);
          return stub(env, claim[1]!).fetch(
            internal(env, "/internal/claim", body, input.headers.get("authorization") ?? undefined),
          );
        }
        if (input.method === "POST" && url.pathname === "/v1/refresh") {
          const body = await boundedJson(input);
          fields(body, ["provider", "refreshToken", "brokerCredential"]);
          const name = provider(body.provider);
          if (!configured[name]) return failure(404);
          const refreshToken = string(body.refreshToken);
          if (
            !(await verifyCapability(
              env.TOKEN_KEY,
              origin,
              name,
              string(body.brokerCredential, 1, 8192),
              { refreshToken },
              "refresh",
            ))
          )
            return failure(403);
          const id = `refresh:${name}:${await hash(refreshToken)}`;
          return stub(env, id).fetch(internal(env, "/internal/refresh", body));
        }
        if (input.method === "POST" && url.pathname === "/v1/revoke") {
          const body = await boundedJson(input);
          fields(body, ["provider", "accessToken", "refreshToken", "brokerCredential"]);
          const name = provider(body.provider);
          if (!configured[name]) return failure(404);
          const accessToken = string(body.accessToken);
          const refreshToken =
            body.refreshToken === undefined ? undefined : string(body.refreshToken);
          if (
            !(await verifyCapability(
              env.TOKEN_KEY,
              origin,
              name,
              string(body.brokerCredential, 1, 8192),
              { accessToken, refreshToken },
              "revoke",
            ))
          )
            return failure(403);
          const revoked = await revokeTokens(
            name,
            { accessToken, refreshToken, tokenType: "Bearer" },
            request,
          );
          return json({ revoked });
        }
        return failure(404);
      } catch {
        return failure();
      }
    },
  };
}
export default createWorker();
