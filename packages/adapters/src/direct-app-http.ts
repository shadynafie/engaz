import * as z from "zod";
import { redactConnectorPayload } from "./connector-safety.js";
import type { DirectAppTokens } from "./direct-app-types.js";
import { readBodyCapped } from "./web-ssrf.js";

export type DirectFetch = typeof fetch;
export const DIRECT_APP_NAMES = {
  github: "GitHub",
  microsoft: "Microsoft 365",
  google: "Google Workspace",
  slack: "Slack",
  notion: "Notion",
  linear: "Linear",
} as const;
export type DirectProvider = keyof typeof DIRECT_APP_NAMES;
export function directProvider(value: string): DirectProvider {
  const provider = value.toLowerCase();
  if (!Object.hasOwn(DIRECT_APP_NAMES, provider)) throw new Error("Unknown app");
  return provider as DirectProvider;
}

export async function directJson(
  fetcher: DirectFetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const response = await fetcher(url, { ...init, redirect: "error", signal: requestSignal });
  const bytes = await readBodyCapped(response, 2 * 1024 * 1024, requestSignal);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The app returned an invalid response");
  }
  if (Array.isArray(data)) return { status: response.status, data: { items: data } };
  if (!data || typeof data !== "object") throw new Error("The app returned an invalid response");
  return { status: response.status, data: data as Record<string, unknown> };
}

export function directAppTokenSecrets(tokens: DirectAppTokens) {
  return [tokens.accessToken, tokens.refreshToken, tokens.brokerCredential].filter(
    (value): value is string => Boolean(value),
  );
}

export function deviceEndpoints(provider: "github" | "microsoft") {
  return provider === "github"
    ? {
        device: "https://github.com/login/device/code",
        token: "https://github.com/login/oauth/access_token",
        scope: "read:user read:org",
      }
    : {
        device: "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
        token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scope: "offline_access User.Read Mail.Read Calendars.Read Files.Read",
      };
}
export function tokensFromResponse(
  data: Record<string, unknown>,
  previous?: DirectAppTokens,
): DirectAppTokens {
  const token = z.string().min(1).max(32_768).parse(data.access_token);
  const expires = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
  return {
    accessToken: token,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : previous?.refreshToken,
    expiresAt: Number.isFinite(expires) && expires > 0 ? Date.now() + expires * 1_000 : undefined,
    scope: typeof data.scope === "string" ? data.scope : previous?.scope,
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
    brokerCredential: previous?.brokerCredential,
  };
}

export async function directProfile(
  fetcher: DirectFetch,
  provider: DirectProvider,
  tokens: DirectAppTokens,
  signal?: AbortSignal,
) {
  const urls: Record<DirectProvider, string> = {
    github: "https://api.github.com/user",
    microsoft: "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    google: "https://openidconnect.googleapis.com/v1/userinfo",
    slack: "https://slack.com/api/auth.test",
    notion: "https://api.notion.com/v1/users/me",
    linear: "https://api.linear.app/graphql",
  };
  const result = await directJson(
    fetcher,
    urls[provider],
    {
      method: provider === "linear" || provider === "slack" ? "POST" : "GET",
      headers: directHeaders(provider, tokens.accessToken),
      ...(provider === "linear"
        ? { body: JSON.stringify({ query: "query { viewer { id name email } } }" }) }
        : {}),
    },
    signal,
  );
  if (result.status < 200 || result.status >= 300 || result.data.ok === false || result.data.errors)
    throw new Error("The app could not verify this account");
  const data =
    provider === "linear"
      ? (result.data.data as { viewer?: Record<string, unknown> } | undefined)?.viewer
      : result.data;
  const accountId = data?.id ?? data?.sub ?? data?.user_id;
  if ((typeof accountId !== "string" && typeof accountId !== "number") || !String(accountId))
    throw new Error("The app could not identify this account");
  const name =
    data?.email ??
    data?.mail ??
    data?.userPrincipalName ??
    data?.login ??
    data?.name ??
    data?.displayName ??
    data?.user;
  const profile = {
    accountId: String(accountId),
    accountLabel: typeof name === "string" ? name : String(accountId),
  };
  const safe = redactConnectorPayload(profile, directAppTokenSecrets(tokens)) as typeof profile;
  if (safe.accountId !== profile.accountId)
    throw new Error("The app could not identify this account");
  safe.accountLabel = safe.accountLabel.replace(/[\r\n\t]/g, " ").slice(0, 160);
  return safe;
}

export function directHeaders(
  provider: DirectProvider,
  accessToken: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(provider === "github"
      ? { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Engaz" }
      : {}),
    ...(provider === "notion" ? { "Notion-Version": "2025-09-03" } : {}),
  };
}

const limit = z.number().int().min(1).max(50).default(20);
const listInput = z.object({ limit }).strict();
const searchInput = z.object({ query: z.string().trim().min(1).max(500), limit }).strict();
const emptyInput = z.object({}).strict();
export const DIRECT_ACTIONS = [
  {
    provider: "github",
    id: "list_repositories",
    description: "List public repositories visible to this account",
    schema: listInput,
  },
  {
    provider: "github",
    id: "list_issues",
    description: "List issues assigned to this GitHub account",
    schema: listInput,
  },
  {
    provider: "microsoft",
    id: "list_mail",
    description: "Read recent Microsoft mail",
    schema: listInput,
  },
  {
    provider: "microsoft",
    id: "list_events",
    description: "Read Microsoft calendar events",
    schema: listInput,
  },
  {
    provider: "microsoft",
    id: "list_files",
    description: "List Microsoft drive files",
    schema: listInput,
  },
  {
    provider: "google",
    id: "list_mail",
    description: "List recent Gmail message identifiers",
    schema: listInput,
  },
  {
    provider: "google",
    id: "read_mail",
    description: "Read one Gmail message",
    schema: z.object({ messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
  },
  {
    provider: "google",
    id: "list_events",
    description: "Read Google Calendar events",
    schema: listInput,
  },
  {
    provider: "google",
    id: "list_files",
    description: "List Google Drive files",
    schema: listInput,
  },
  {
    provider: "slack",
    id: "search_messages",
    description: "Search Slack messages",
    schema: searchInput,
  },
  {
    provider: "notion",
    id: "search_pages",
    description: "Search Notion pages",
    schema: searchInput,
  },
  {
    provider: "linear",
    id: "list_issues",
    description: "Read recent Linear issues",
    schema: listInput,
  },
  {
    provider: "github",
    id: "read_account",
    description: "Read the connected GitHub account",
    schema: emptyInput,
  },
] as const;

export function directActionRequest(
  provider: DirectProvider,
  actionId: string,
  input: Record<string, unknown>,
) {
  const action = DIRECT_ACTIONS.find((item) => item.provider === provider && item.id === actionId);
  if (!action) throw new Error("This app action is not available");
  const args = action.schema.parse(input) as { limit?: number; query?: string; messageId?: string };
  const count = args.limit ?? 20;
  let url: string;
  let body: string | undefined;
  if (provider === "github")
    url =
      actionId === "read_account"
        ? "https://api.github.com/user"
        : actionId === "list_repositories"
          ? `https://api.github.com/user/repos?visibility=public&per_page=${count}&sort=updated`
          : `https://api.github.com/issues?filter=assigned&per_page=${count}`;
  else if (provider === "microsoft")
    url =
      actionId === "list_mail"
        ? `https://graph.microsoft.com/v1.0/me/messages?$top=${count}&$select=id,subject,from,receivedDateTime,bodyPreview`
        : actionId === "list_events"
          ? `https://graph.microsoft.com/v1.0/me/events?$top=${count}&$select=id,subject,start,end,webLink`
          : `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=${count}&$select=id,name,size,webUrl`;
  else if (provider === "google")
    url =
      actionId === "list_mail"
        ? `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}`
        : actionId === "read_mail"
          ? `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(args.messageId!)}?format=full`
          : actionId === "list_events"
            ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${count}&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`
            : `https://www.googleapis.com/drive/v3/files?pageSize=${count}&fields=files(id,name,mimeType,webViewLink)`;
  else if (provider === "slack")
    url = `https://slack.com/api/search.messages?query=${encodeURIComponent(args.query!)}&count=${count}`;
  else if (provider === "notion") {
    url = "https://api.notion.com/v1/search";
    body = JSON.stringify({ query: args.query, page_size: count });
  } else {
    url = "https://api.linear.app/graphql";
    body = JSON.stringify({
      query:
        "query($first:Int!) { issues(first:$first) { nodes { id identifier title url state { name } } } }",
      variables: { first: count },
    });
  }
  return { url, method: body ? "POST" : "GET", body };
}
