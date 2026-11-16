import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@engaz/db";
import { z } from "zod";
import { readBoundedText } from "./connector-http.js";
import { DirectAppConnector } from "./direct-app-connector.js";
import type { DirectFetch } from "./direct-app-http.js";
import type { DirectAppBroker, DirectAppSettings, DirectAppTokens } from "./direct-app-types.js";
import { secureFetch } from "./mcp-transport.js";
import type { RemoteTransportDependencies } from "./remote-mcp.js";
import type { EncryptedSecretStore } from "./secrets.js";

const Tokens = z.object({
  accessToken: z.string().min(1).max(32_768),
  refreshToken: z.string().min(1).max(32_768).optional(),
  expiresAt: z.number().finite().positive().optional(),
  scope: z.string().max(8192).optional(),
  tokenType: z.literal("Bearer").optional(),
  brokerCredential: z.string().min(1).max(8192),
});
const Started = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{32,128}$/),
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
const PublicClients = z.object({
  githubClientId: z.string().min(1).max(512).optional(),
  microsoftClientId: z.string().uuid().optional(),
});
const Catalog = z.object({
  providers: z.array(z.string().max(64)).max(32),
  publicClients: PublicClients.optional(),
});
const signInHosts: Record<string, string> = {
  google: "accounts.google.com",
  slack: "slack.com",
  notion: "api.notion.com",
  linear: "linear.app",
};

/** Only the NAS stores account credentials; the helper processes sign-in and renewal. */
export class HttpDirectAppBroker implements DirectAppBroker {
  private readonly base: URL;
  private readonly request: typeof fetch;
  private providers = new Set<string>();
  private checkedAt = 0;
  publicClients: z.infer<typeof PublicClients> = {};

  constructor(url: string, network: RemoteTransportDependencies = {}) {
    this.base = new URL(url);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/"
    ) {
      throw new Error("The connection service requires an HTTPS origin");
    }
    this.request = secureFetch(this.base, {}, {}, network);
  }

  available(provider: string): boolean {
    return this.providers.has(provider);
  }

  async refreshAvailability(): Promise<void> {
    if (Date.now() - this.checkedAt < 30_000) return;
    this.checkedAt = Date.now();
    try {
      const response = await this.call("/v1/catalog", undefined, undefined, 3000);
      const catalog = Catalog.parse(response);
      this.providers = new Set(
        catalog.providers.filter((provider) => Boolean(signInHosts[provider])),
      );
      this.publicClients = catalog.publicClients ?? {};
    } catch {
      this.providers.clear();
    }
  }

  async begin(input: Parameters<DirectAppBroker["begin"]>[0]) {
    const claimSecret = randomBytes(32).toString("base64url");
    const claimChallenge = createHash("sha256").update(claimSecret).digest("base64url");
    const result = Started.parse(
      await this.call("/v1/authorizations", {
        provider: input.provider,
        state: input.state,
        installationId: input.installationId,
        claimChallenge,
      }),
    );
    // The browser never receives the credential needed to retrieve the result.
    const authorization = new URL(result.authorizationUrl);
    if (
      authorization.protocol !== "https:" ||
      authorization.username ||
      authorization.password ||
      authorization.hostname !== signInHosts[input.provider] ||
      authorization.hash
    ) {
      throw new Error("The connection service returned an invalid sign-in address");
    }
    return { ...result, sessionId: `${result.sessionId}.${claimSecret}` };
  }

  async complete(
    input: Parameters<DirectAppBroker["complete"]>[0],
  ): Promise<DirectAppTokens | null> {
    const [sessionId, claimSecret, extra] = input.sessionId.split(".");
    if (
      !sessionId ||
      !claimSecret ||
      extra ||
      !/^[a-zA-Z0-9_-]{32,128}$/.test(sessionId) ||
      !/^[a-zA-Z0-9_-]{43}$/.test(claimSecret)
    ) {
      throw new Error("Invalid sign-in session");
    }
    const result = await this.call(
      `/v1/authorizations/${sessionId}`,
      {
        provider: input.provider,
        state: input.state,
      },
      claimSecret,
    );
    if (result === null) return null;
    return Tokens.parse(result);
  }

  async refresh(input: Parameters<DirectAppBroker["refresh"]>[0]): Promise<DirectAppTokens> {
    return Tokens.parse(await this.call("/v1/refresh", input));
  }

  async revoke(input: Parameters<NonNullable<DirectAppBroker["revoke"]>>[0]): Promise<void> {
    await this.call("/v1/revoke", input);
  }

  private async call(
    path: string,
    body?: unknown,
    credential?: string,
    timeoutMs = 10_000,
  ): Promise<unknown> {
    try {
      const response = await this.request(new URL(path, this.base), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 202) return null;
      if (!response.ok) throw new Error("Connection service request failed");
      const content = await readBoundedText(response, 131_072);
      if (content.truncated) throw new Error("Connection service response is too large");
      return JSON.parse(content.text);
    } catch {
      // A service response can contain codes or tokens; never surface its body or URL.
      throw new Error("Could not reach the connection service. Try again.");
    }
  }
}

export async function configureDirectApps(
  settings: DirectAppSettings,
  network: RemoteTransportDependencies = {},
): Promise<{ settings: DirectAppSettings; broker?: HttpDirectAppBroker }> {
  const connectUrl =
    settings.connectUrl ??
    (process.env.NODE_ENV === "production" ? "https://connect.engaz.app" : undefined);
  if (!connectUrl) return { settings };
  const broker = new HttpDirectAppBroker(connectUrl, network);
  await broker.refreshAvailability();
  return {
    settings: {
      ...settings,
      connectUrl,
      get githubClientId() {
        return settings.githubClientId ?? broker.publicClients.githubClientId;
      },
      get microsoftClientId() {
        return settings.microsoftClientId ?? broker.publicClients.microsoftClientId;
      },
    },
    broker,
  };
}

export async function createConfiguredDirectApps(input: {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  identitySecret: string;
  settings: DirectAppSettings;
  network?: RemoteTransportDependencies;
  fetch?: DirectFetch;
}): Promise<DirectAppConnector> {
  const configured = await configureDirectApps(input.settings, input.network);
  return new DirectAppConnector({ ...input, ...configured });
}
