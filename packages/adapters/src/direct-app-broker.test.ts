import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDirectApps, HttpDirectAppBroker } from "./direct-app-broker.js";

const sessionId = "a".repeat(43);
const fakeTokens = {
  accessToken: "fake-access",
  refreshToken: "fake-refresh",
  brokerCredential: "fake-capability",
  tokenType: "Bearer",
};
function helper(handler: (request: Request) => Response | Promise<Response>) {
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init)),
  );
  const broker = new HttpDirectAppBroker("https://connect.engaz.test", {
    fetch: request,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  return { broker, request };
}

describe("Engaz connection service client", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("discovers publisher client IDs without NAS settings and refreshes them later", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let clientId = "first-client";
    const request = vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).origin).toBe("https://connect.engaz.app");
      return Response.json({ providers: [], publicClients: { githubClientId: clientId } });
    });
    const configured = await configureDirectApps(
      {},
      { fetch: request, resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }] },
    );
    expect(configured.settings.githubClientId).toBe("first-client");
    clientId = "second-client";
    const now = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(now + 31_000)
      .mockReturnValueOnce(now + 31_000);
    await configured.broker!.refreshAvailability();
    expect(configured.settings.githubClientId).toBe("second-client");
    vi.restoreAllMocks();
    expect(await configureDirectApps({ connectUrl: "" })).toEqual({ settings: { connectUrl: "" } });
  });
  it("only lists apps the publisher has configured", async () => {
    const { broker } = helper(() =>
      Response.json({
        providers: ["google", "unknown"],
        publicClients: { githubClientId: "fake-public-id" },
      }),
    );
    expect(broker.available("google")).toBe(false);
    await broker.refreshAvailability();
    expect(broker.available("google")).toBe(true);
    expect(broker.available("unknown")).toBe(false);
    expect(broker.publicClients.githubClientId).toBe("fake-public-id");
  });
  it("keeps the claim credential off browser URLs and binds the result to the NAS", async () => {
    let challenge = "";
    const { broker } = helper(async (request) => {
      if (new URL(request.url).pathname === "/v1/authorizations") {
        const body = (await request.json()) as Record<string, string>;
        challenge = body.claimChallenge!;
        expect(body.redirectUrl).toBeUndefined();
        return Response.json({
          sessionId,
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=browser-nonce",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      const secret = request.headers.get("authorization")!.slice(7);
      expect(createHash("sha256").update(secret).digest("base64url")).toBe(challenge);
      expect(await request.json()).toEqual({ provider: "google", state: "nas-state" });
      return Response.json(fakeTokens);
    });
    const started = await broker.begin({
      provider: "google",
      state: "nas-state",
      installationId: "test-installation",
      redirectUrl: "https://installation.example/app",
    });
    expect(started.authorizationUrl).not.toContain(started.sessionId.split(".")[1]);
    expect(
      await broker.complete({
        provider: "google",
        state: "nas-state",
        sessionId: started.sessionId,
      }),
    ).toEqual(fakeTokens);
  });
  it("does not expose service errors containing tokens", async () => {
    const { broker } = helper(
      () => new Response("fake-refresh-token in provider debug output", { status: 401 }),
    );
    await expect(
      broker.refresh({
        provider: "google",
        refreshToken: "fake-refresh",
        brokerCredential: "capability",
      }),
    ).rejects.toThrow("Could not reach the connection service. Try again.");
  });
  it("rejects sign-in links to unrelated sites", async () => {
    const { broker } = helper(() =>
      Response.json({
        sessionId,
        authorizationUrl: "https://unrelated.example/login",
        expiresAt: new Date().toISOString(),
      }),
    );
    await expect(
      broker.begin({
        provider: "google",
        state: "state",
        redirectUrl: "https://installation.example",
        installationId: "installation",
      }),
    ).rejects.toThrow("invalid sign-in address");
  });
  it("keeps a pending response pending and refuses non-HTTPS helper addresses", async () => {
    const { broker } = helper(() => new Response(null, { status: 202 }));
    expect(
      await broker.complete({
        provider: "google",
        sessionId: `${sessionId}.${"b".repeat(43)}`,
        state: "state",
      }),
    ).toBeNull();
    expect(() => new HttpDirectAppBroker("http://127.0.0.1:8787")).toThrow("HTTPS origin");
    expect(() => new HttpDirectAppBroker("https://connect.example/?key=secret")).toThrow(
      "HTTPS origin",
    );
  });
  it("does not add a service dependency when integrations are disabled", async () => {
    expect(await configureDirectApps({})).toEqual({ settings: {} });
  });
});
