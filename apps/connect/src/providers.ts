import type { Client, Env, Provider, Tokens } from "./platform.js";

export const PROVIDERS: Record<Provider, { authorize: string; token: string; scopes: string }> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes:
      "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
  },
  slack: {
    authorize: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
    scopes: "search:read",
  },
  notion: {
    authorize: "https://api.notion.com/v1/oauth/authorize",
    token: "https://api.notion.com/v1/oauth/token",
    scopes: "",
  },
  linear: {
    authorize: "https://linear.app/oauth/authorize",
    token: "https://api.linear.app/oauth/token",
    scopes: "read",
  },
};
export function provider(value: unknown): Provider {
  if (typeof value !== "string" || !Object.hasOwn(PROVIDERS, value))
    throw new Error("Invalid provider");
  return value as Provider;
}
export function publicOrigin(env: Env): string {
  const url = new URL(env.PUBLIC_ORIGIN);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid origin configuration");
  return url.origin;
}
export function clients(env: Env): Partial<Record<Provider, Client>> {
  const source = JSON.parse(env.PROVIDERS) as Record<string, unknown>;
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("Invalid provider configuration");
  const result: Partial<Record<Provider, Client>> = {};
  for (const [name, value] of Object.entries(source)) {
    const id = provider(name);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid provider configuration");
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => key !== "clientId" && key !== "clientSecret") ||
      typeof item.clientId !== "string" ||
      !item.clientId ||
      typeof item.clientSecret !== "string" ||
      !item.clientSecret
    )
      throw new Error("Invalid provider configuration");
    result[id] = { clientId: item.clientId, clientSecret: item.clientSecret };
  }
  return result;
}
export function authorizationUrl(env: Env, name: Provider, state: string): string {
  const client = clients(env)[name];
  if (!client) throw new Error("Provider unavailable");
  const url = new URL(PROVIDERS[name].authorize);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", `${publicOrigin(env)}/oauth/callback/${name}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (name === "slack") url.searchParams.set("user_scope", PROVIDERS[name].scopes);
  else if (PROVIDERS[name].scopes) url.searchParams.set("scope", PROVIDERS[name].scopes);
  if (name === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (name === "notion") url.searchParams.set("owner", "user");
  return url.toString();
}
export async function boundedJson(
  request: Request | Response,
  limit = 131_072,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error("Request too large");
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid request");
  return parsed as Record<string, unknown>;
}
async function tokenRequest(
  env: Env,
  name: Provider,
  fields: Record<string, string>,
  request: typeof fetch,
): Promise<Record<string, unknown>> {
  const client = clients(env)[name];
  if (!client) throw new Error("Provider unavailable");
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string;
  if (name === "notion") {
    headers.Authorization = `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(fields);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams({
      ...fields,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }).toString();
  }
  const response = await request(PROVIDERS[name].token, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const value = await boundedJson(response);
  if (!response.ok || value.error || value.ok === false)
    throw new Error("Provider authorization failed");
  return name === "slack" && value.authed_user && typeof value.authed_user === "object"
    ? (value.authed_user as Record<string, unknown>)
    : value;
}
function tokens(value: Record<string, unknown>, previous?: string): Tokens {
  if (
    typeof value.access_token !== "string" ||
    !value.access_token ||
    value.access_token.length > 32_768
  )
    throw new Error("Invalid provider token");
  if (
    value.refresh_token !== undefined &&
    (typeof value.refresh_token !== "string" ||
      !value.refresh_token ||
      value.refresh_token.length > 32_768)
  )
    throw new Error("Invalid provider token");
  if (value.scope !== undefined && (typeof value.scope !== "string" || value.scope.length > 8192))
    throw new Error("Invalid provider token");
  const duration = Number(value.expires_in);
  return {
    accessToken: value.access_token,
    refreshToken: (value.refresh_token as string | undefined) ?? previous,
    expiresAt: Number.isFinite(duration) && duration > 0 ? Date.now() + duration * 1000 : undefined,
    scope: value.scope as string | undefined,
    tokenType: "Bearer",
  };
}
export async function exchangeCode(
  env: Env,
  name: Provider,
  code: string,
  request: typeof fetch,
): Promise<Tokens> {
  return tokens(
    await tokenRequest(
      env,
      name,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: `${publicOrigin(env)}/oauth/callback/${name}`,
      },
      request,
    ),
  );
}
export async function refreshTokens(
  env: Env,
  name: Provider,
  refreshToken: string,
  request: typeof fetch,
): Promise<Tokens> {
  return tokens(
    await tokenRequest(
      env,
      name,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      request,
    ),
    refreshToken,
  );
}
export async function revokeTokens(
  name: Provider,
  value: Tokens,
  request: typeof fetch,
): Promise<boolean> {
  if (name === "notion") return false;
  const url =
    name === "google"
      ? "https://oauth2.googleapis.com/revoke"
      : name === "slack"
        ? "https://slack.com/api/auth.revoke"
        : "https://api.linear.app/oauth/revoke";
  const token = name === "slack" ? value.accessToken : (value.refreshToken ?? value.accessToken);
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ token }).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Provider revocation failed");
  if (name === "slack") {
    const result = await boundedJson(response);
    if (result.ok !== true || result.revoked !== true)
      throw new Error("Provider revocation failed");
  }
  return true;
}
