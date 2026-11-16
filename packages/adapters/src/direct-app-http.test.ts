import { describe, expect, it, vi } from "vitest";
import type { DirectProvider } from "./direct-app-http.js";
import {
  DIRECT_ACTIONS,
  directActionRequest,
  directHeaders,
  directJson,
  directProfile,
  directProvider,
} from "./direct-app-http.js";

// Independent protocol fixtures keep every advertised action on a fixed official API.
const actions = [
  ["github", "list_repositories", "api.github.com", "/user/repos", "GET", { limit: 3 }, "per_page"],
  ["github", "list_issues", "api.github.com", "/issues", "GET", { limit: 3 }, "per_page"],
  ["github", "read_account", "api.github.com", "/user", "GET", {}, null],
  [
    "microsoft",
    "list_mail",
    "graph.microsoft.com",
    "/v1.0/me/messages",
    "GET",
    { limit: 3 },
    "$top",
  ],
  [
    "microsoft",
    "list_events",
    "graph.microsoft.com",
    "/v1.0/me/events",
    "GET",
    { limit: 3 },
    "$top",
  ],
  [
    "microsoft",
    "list_files",
    "graph.microsoft.com",
    "/v1.0/me/drive/root/children",
    "GET",
    { limit: 3 },
    "$top",
  ],
  [
    "google",
    "list_mail",
    "gmail.googleapis.com",
    "/gmail/v1/users/me/messages",
    "GET",
    { limit: 3 },
    "maxResults",
  ],
  [
    "google",
    "read_mail",
    "gmail.googleapis.com",
    "/gmail/v1/users/me/messages/message_123",
    "GET",
    { messageId: "message_123" },
    null,
  ],
  [
    "google",
    "list_events",
    "www.googleapis.com",
    "/calendar/v3/calendars/primary/events",
    "GET",
    { limit: 3 },
    "maxResults",
  ],
  [
    "google",
    "list_files",
    "www.googleapis.com",
    "/drive/v3/files",
    "GET",
    { limit: 3 },
    "pageSize",
  ],
  [
    "slack",
    "search_messages",
    "slack.com",
    "/api/search.messages",
    "GET",
    { query: "one & two", limit: 3 },
    "count",
  ],
  [
    "notion",
    "search_pages",
    "api.notion.com",
    "/v1/search",
    "POST",
    { query: "one & two", limit: 3 },
    null,
  ],
  ["linear", "list_issues", "api.linear.app", "/graphql", "POST", { limit: 3 }, null],
] as const;

describe("direct app protocol conformance", () => {
  it("covers every advertised read-only action", () => {
    expect(DIRECT_ACTIONS.map(({ provider, id }) => `${provider}:${id}`).sort()).toEqual(
      actions.map(([provider, id]) => `${provider}:${id}`).sort(),
    );
  });
  it.each(actions)(
    "%s %s stays on its official endpoint",
    (provider, action, hostname, pathname, method, args, limitName) => {
      const request = directActionRequest(provider, action, args);
      const url = new URL(request.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe(hostname);
      expect(url.pathname).toBe(pathname);
      expect(request.method).toBe(method);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      if (limitName) expect(url.searchParams.get(limitName)).toBe("3");
      if (provider === "slack") expect(url.searchParams.get("query")).toBe("one & two");
      if (provider === "notion")
        expect(JSON.parse(request.body!)).toEqual({ query: "one & two", page_size: 3 });
      if (provider === "linear")
        expect(JSON.parse(request.body!)).toMatchObject({ variables: { first: 3 } });
      expect(directHeaders(provider, "private-access-token").Authorization).toBe(
        "Bearer private-access-token",
      );
    },
  );
  it.each(actions)(
    "%s %s rejects an arbitrary destination or extra command",
    (provider, action, _host, _path, _method, args) => {
      expect(() =>
        directActionRequest(provider, action, {
          ...args,
          url: "http://127.0.0.1/private",
          command: "delete",
        }),
      ).toThrow();
    },
  );
  it("rejects unknown/inherited provider names and unsafe path identifiers", () => {
    for (const name of ["constructor", "__proto__", "toString", "unknown"])
      expect(() => directProvider(name)).toThrow("Unknown app");
    expect(() =>
      directActionRequest("google", "read_mail", { messageId: "../../token" }),
    ).toThrow();
    expect(() => directActionRequest("github", "delete_repository", {})).toThrow();
  });
  it("normalizes API arrays without dropping repository results", async () => {
    const fetcher = vi.fn(async () => Response.json([{ id: 42, name: "example" }]));
    const result = await directJson(
      fetcher as typeof fetch,
      "https://api.github.com/user/repos",
      {},
    );
    expect(result.data).toEqual({ items: [{ id: 42, name: "example" }] });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/user/repos",
      expect.objectContaining({ redirect: "error" }),
    );
  });
});

const profiles: Array<[DirectProvider, string, string, string, unknown, string]> = [
  [
    "github",
    "api.github.com",
    "/user",
    "GET",
    { id: 42, login: "example-reader" },
    "example-reader",
  ],
  [
    "microsoft",
    "graph.microsoft.com",
    "/v1.0/me",
    "GET",
    { id: "ms-user", displayName: "Example Reader", mail: "reader@example.test" },
    "reader@example.test",
  ],
  [
    "google",
    "openidconnect.googleapis.com",
    "/v1/userinfo",
    "GET",
    { sub: "google-user", email: "reader@example.test" },
    "reader@example.test",
  ],
  [
    "slack",
    "slack.com",
    "/api/auth.test",
    "POST",
    { ok: true, user_id: "slack-user", user: "example-reader" },
    "example-reader",
  ],
  [
    "notion",
    "api.notion.com",
    "/v1/users/me",
    "GET",
    { id: "notion-user", type: "bot", name: "Example workspace" },
    "Example workspace",
  ],
  [
    "linear",
    "api.linear.app",
    "/graphql",
    "POST",
    {
      data: { viewer: { id: "linear-user", name: "Example Reader", email: "reader@example.test" } },
    },
    "reader@example.test",
  ],
];
describe("direct profile checks", () => {
  it.each(profiles)(
    "verifies %s using its account endpoint",
    async (provider, hostname, pathname, method, response, accountLabel) => {
      const fetcher = vi.fn(async () => Response.json(response));
      const profile = await directProfile(fetcher as typeof fetch, provider, {
        accessToken: "private-access-token",
      });
      expect(profile.accountLabel).toBe(accountLabel);
      expect(profile.accountId).toBeTruthy();
      const [raw, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      const url = new URL(raw);
      expect(url.hostname).toBe(hostname);
      expect(url.pathname).toBe(pathname);
      expect(request.method).toBe(method);
      expect(request.headers).toMatchObject({ Authorization: "Bearer private-access-token" });
    },
  );
  it.each(profiles)("never marks a rejected %s account as verified", async (provider) => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "private-access-token" }, { status: 401 }),
    );
    await expect(
      directProfile(fetcher as typeof fetch, provider, { accessToken: "private-access-token" }),
    ).rejects.toThrow("could not verify");
  });
  it("redacts long tokens before shortening a profile label", async () => {
    const token = `private-${"a".repeat(240)}`;
    const profile = await directProfile(
      (async () => Response.json({ sub: "account", email: `Owner ${token}` })) as typeof fetch,
      "google",
      { accessToken: token },
    );
    expect(profile.accountLabel).toBe("Owner [redacted]");
  });
});
