import { createHash, createHmac, randomBytes } from "node:crypto";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
} from "@engaz/adapter-kit";
import type { Connection } from "@engaz/contracts";
import type { Prisma, PrismaClient } from "@engaz/db";
import { IsolationError } from "@engaz/db";
import * as z from "zod";
import { redactConnectorPayload } from "./connector-safety.js";
import type { DirectFetch, DirectProvider } from "./direct-app-http.js";
import {
  DIRECT_ACTIONS,
  DIRECT_APP_NAMES,
  deviceEndpoints,
  directActionRequest,
  directAppTokenSecrets,
  directHeaders,
  directJson,
  directProfile,
  directProvider,
  tokensFromResponse,
} from "./direct-app-http.js";
import type { DirectAppBroker, DirectAppSettings, DirectAppTokens } from "./direct-app-types.js";
import type { EncryptedSecretStore } from "./secrets.js";

const SECRET_KIND = "direct.connection";
const Tokens = z.object({
  accessToken: z.string().min(1).max(32_768),
  refreshToken: z.string().min(1).max(32_768).optional(),
  expiresAt: z.number().finite().positive().optional(),
  scope: z.string().max(8192).optional(),
  tokenType: z.string().max(32).optional(),
  brokerCredential: z.string().min(1).max(8192).optional(),
});
type Owner = {
  userId: string;
  spaceId: string;
  connectionId: string;
  installationId: string;
  provider: DirectProvider;
};
type Pending = Owner & {
  kind: "device" | "broker";
  authorizationId: string;
  expiresAt: number;
  nextPollAt: number;
  interval: number;
  deviceCode?: string;
  clientId?: string;
  sessionId?: string;
};
type TokenState = Owner & {
  kind: "token";
  clientId?: string;
  authorizationId: string;
  viaBroker: boolean;
  tokens: DirectAppTokens;
};
type ConnectionRow = Prisma.ConnectionGetPayload<{ include: { botConnections: true } }>;

export function mapAppConnection(
  row: {
    id: string;
    connectorId: string;
    provider: string;
    displayName: string;
    status: string;
    createdAt: Date;
    accountLabel?: string | null;
    checkedAt?: Date | null;
  },
  agentIds: string[] = [],
): Connection {
  return {
    id: row.id,
    connectorId: row.connectorId,
    provider: row.provider,
    displayName: row.displayName,
    status: row.status as Connection["status"],
    capabilities: [],
    createdAt: row.createdAt.toISOString(),
    agentIds,
    accountLabel: row.accountLabel ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
  };
}

export class DirectAppConnector implements ManagedConnectorProvider {
  private readonly installationId: string;
  private readonly fetcher: DirectFetch;
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      secrets: EncryptedSecretStore;
      settings: DirectAppSettings;
      identitySecret: string;
      broker?: DirectAppBroker;
      fetch?: DirectFetch;
    },
  ) {
    this.installationId = createHmac("sha256", deps.identitySecret)
      .update("engaz-direct-installation")
      .digest("base64url");
    this.fetcher = deps.fetch ?? fetch;
  }
  describe() {
    return {
      id: "direct",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }
  async catalog(context: AdapterContext, query = "") {
    await this.deps.broker?.refreshAvailability?.();
    const connected = await this.listConnectedExternalIds(context);
    return Object.entries(DIRECT_APP_NAMES)
      .filter(([id, name]) => `${id} ${name}`.toLowerCase().includes(query.trim().toLowerCase()))
      .map(([slug, name]) => ({
        connectorId: "direct",
        slug,
        name,
        logo: null,
        connected: connected.includes(slug),
        noAuth: false,
        available: this.available(directProvider(slug)),
        setupRequired: !this.available(directProvider(slug)),
      }));
  }
  private available(provider: DirectProvider) {
    return Boolean(this.clientId(provider) || this.deps.broker?.available(provider));
  }
  private clientId(provider: DirectProvider) {
    return provider === "github"
      ? this.deps.settings.githubClientId
      : provider === "microsoft"
        ? this.deps.settings.microsoftClientId
        : undefined;
  }
  private scope(context: AdapterContext) {
    return { userId: context.userId, spaceId: context.spaceId, connectorId: "direct" };
  }
  private async owned(
    id: string,
    context: AdapterContext,
    tx: Prisma.TransactionClient | PrismaClient = this.deps.prisma,
  ) {
    const row = await tx.connection.findFirst({
      where: { id, ...this.scope(context) },
      include: { botConnections: true },
    });
    if (!row) throw new IsolationError();
    return row;
  }
  private dto(row: ConnectionRow) {
    return mapAppConnection(
      row,
      row.botConnections.map((grant) => grant.botId),
    );
  }
  async listConnectedExternalIds(context: AdapterContext) {
    const rows = await this.deps.prisma.connection.findMany({
      where: { ...this.scope(context), status: "connected", checkedAt: { not: null } },
      select: { provider: true },
    });
    return [...new Set(rows.map((row) => row.provider))];
  }
  async connectionReady(context: AdapterContext, provider: string) {
    return (await this.listConnectedExternalIds(context)).includes(directProvider(provider));
  }
  async beginConnection(
    input: { provider: string; displayName: string; connectionId?: string; redirectUrl: string },
    context: AdapterContext,
  ) {
    const provider = directProvider(input.provider);
    await this.deps.broker?.refreshAvailability?.();
    if (!this.available(provider))
      throw new Error("This app is not available on this installation yet");
    const row = await this.deps.prisma.$transaction(async (tx) => {
      if (!input.connectionId)
        return tx.connection.create({
          data: {
            ...this.scope(context),
            provider,
            displayName: input.displayName.slice(0, 80),
            status: "pending",
          },
          include: { botConnections: true },
        });
      await tx.$queryRaw`SELECT id FROM connections WHERE id = ${input.connectionId} FOR UPDATE`;
      const current = await this.owned(input.connectionId, context, tx);
      if (current.provider !== provider) throw new IsolationError();
      const updated = await tx.connection.update({
        where: { id: current.id },
        data: {
          status: "pending",
          revision: { increment: 1 },
          secretId: null,
          providerRef: null,
          metadata: {},
          checkedAt: null,
        },
        include: { botConnections: true },
      });
      await tx.botConnection.deleteMany({
        where: { connectionId: current.id, userId: context.userId, spaceId: context.spaceId },
      });
      updated.botConnections = [];
      if (current.secretId)
        await tx.secret.deleteMany({
          where: {
            id: current.secretId,
            userId: context.userId,
            spaceId: context.spaceId,
            kind: SECRET_KIND,
          },
        });
      return updated;
    });
    const authorizationId = randomBytes(32).toString("base64url");
    const base = {
      userId: context.userId,
      spaceId: context.spaceId,
      connectionId: row.id,
      installationId: this.installationId,
      provider,
      authorizationId,
    };
    try {
      let pending: Pending;
      let authorizationUrl: string;
      let userCode: string | undefined;
      let verificationUri: string | undefined;
      const clientId = this.clientId(provider);
      if (clientId && (provider === "github" || provider === "microsoft")) {
        const endpoint = deviceEndpoints(provider);
        const response = await directJson(
          this.fetcher,
          endpoint.device,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ client_id: clientId, scope: endpoint.scope }).toString(),
          },
          context.signal,
        );
        if (response.status < 200 || response.status >= 300 || response.data.error)
          throw new Error("Could not start app sign-in");
        const device = z
          .object({
            device_code: z.string().min(1).max(8192),
            user_code: z.string().min(1).max(64),
            verification_uri: z.string().url(),
            expires_in: z.number().int().min(1).max(3600),
            interval: z.number().int().min(1).max(60).default(5),
          })
          .parse(response.data);
        const verify = new URL(device.verification_uri);
        const allowed =
          provider === "github"
            ? ["https://github.com"]
            : [
                "https://microsoft.com",
                "https://www.microsoft.com",
                "https://login.microsoftonline.com",
              ];
        if (!allowed.includes(verify.origin) || verify.username || verify.password)
          throw new Error("The app returned an invalid sign-in address");
        pending = {
          ...base,
          kind: "device",
          clientId,
          deviceCode: device.device_code,
          expiresAt: Date.now() + device.expires_in * 1000,
          nextPollAt: Date.now() + device.interval * 1000,
          interval: device.interval,
        };
        userCode = device.user_code;
        verificationUri = device.verification_uri;
        authorizationUrl = verificationUri;
      } else {
        const started = await this.deps.broker!.begin({
          provider,
          redirectUrl: input.redirectUrl,
          state: authorizationId,
          installationId: this.installationId,
        });
        const address = new URL(started.authorizationUrl);
        const expiresAt = new Date(started.expiresAt).getTime();
        if (
          address.protocol !== "https:" ||
          address.username ||
          address.password ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now() ||
          expiresAt > Date.now() + 60 * 60_000
        )
          throw new Error("The app returned an invalid sign-in session");
        pending = {
          ...base,
          kind: "broker",
          sessionId: started.sessionId,
          expiresAt,
          nextPollAt: Date.now() + 2000,
          interval: 2,
        };
        authorizationUrl = started.authorizationUrl;
      }
      await this.deps.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM connections WHERE id = ${row.id} FOR UPDATE`;
        const current = await this.owned(row.id, context, tx);
        if (current.revision !== row.revision || current.status !== "pending")
          throw new IsolationError();
        await this.save(tx, current, pending, context, {
          metadata: { authorizationId, expiresAt: new Date(pending.expiresAt).toISOString() },
        });
      });
      return {
        connectionId: row.id,
        authorizationId,
        authorizationUrl,
        userCode,
        verificationUri,
        expiresAt: new Date(pending.expiresAt).toISOString(),
        pollIntervalSeconds: pending.interval,
      };
    } catch (error) {
      await this.markError(row.id, row.revision, context);
      throw new Error(
        error instanceof IsolationError
          ? "This sign-in is no longer active"
          : "Could not start app sign-in. Try again.",
      );
    }
  }
  async completeConnection(
    id: string,
    authorizationId: string | undefined,
    context: AdapterContext,
    code?: string,
  ) {
    let revision: number | undefined;
    try {
      return await this.deps.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM connections WHERE id = ${id} FOR UPDATE`;
          const row = await this.owned(id, context, tx);
          if (row.status !== "pending" && row.status !== "connected") throw new IsolationError();
          const state = await this.read(row, context, tx);
          if (!authorizationId || state.authorizationId !== authorizationId)
            throw new IsolationError();
          if (state.kind === "token") return this.dto(row);
          revision = row.revision;
          if (state.expiresAt <= Date.now()) throw new Error("Sign-in expired");
          if (state.nextPollAt > Date.now()) return this.dto(row);
          let tokens: DirectAppTokens | null;
          if (state.kind === "device") {
            if (state.provider !== "github" && state.provider !== "microsoft")
              throw new Error("Invalid device provider");
            const result = await directJson(
              this.fetcher,
              deviceEndpoints(state.provider).token,
              {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  client_id: state.clientId!,
                  device_code: state.deviceCode!,
                  grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                }).toString(),
              },
              context.signal,
            );
            if (
              result.data.error === "authorization_pending" ||
              result.data.error === "slow_down"
            ) {
              if (result.data.error === "slow_down") state.interval += 5;
              state.nextPollAt = Date.now() + state.interval * 1000;
              await this.save(tx, row, state, context);
              return this.dto(row);
            }
            if (result.status < 200 || result.status >= 300 || result.data.error)
              throw new Error("Sign-in was declined or expired");
            tokens = tokensFromResponse(result.data);
          } else
            tokens = await this.deps.broker!.complete({
              provider: row.provider,
              sessionId: state.sessionId!,
              state: authorizationId,
              code,
            });
          if (!tokens) {
            state.nextPollAt = Date.now() + state.interval * 1000;
            await this.save(tx, row, state, context);
            return this.dto(row);
          }
          tokens = Tokens.parse(tokens);
          const profile = await directProfile(this.fetcher, state.provider, tokens, context.signal);
          const connected = await this.save(
            tx,
            row,
            { ...state, kind: "token", viaBroker: state.kind === "broker", tokens },
            context,
            {
              status: "connected",
              providerRef: row.id,
              accountLabel: profile.accountLabel,
              checkedAt: new Date(),
              metadata: { authorizationId, accountId: profile.accountId },
            },
          );
          return this.dto(connected);
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (revision !== undefined && !(error instanceof IsolationError))
        await this.markError(id, revision, context);
      throw new Error(
        error instanceof IsolationError
          ? "This sign-in is no longer active"
          : "Could not finish app sign-in. Connect again.",
      );
    }
  }
  private async save(
    tx: Prisma.TransactionClient,
    row: ConnectionRow,
    value: Pending | TokenState,
    context: AdapterContext,
    patch: Prisma.ConnectionUpdateManyMutationInput = {},
  ) {
    const stored = await this.deps.secrets.put(JSON.stringify(value), context);
    await tx.secret.create({
      data: {
        id: stored.id,
        userId: row.userId,
        spaceId: row.spaceId,
        kind: SECRET_KIND,
        ciphertext: stored.ciphertext,
      },
    });
    const changed = await tx.connection.updateMany({
      where: { id: row.id, revision: row.revision, status: row.status },
      data: { ...patch, secretId: stored.id, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new IsolationError();
    if (row.secretId)
      await tx.secret.deleteMany({
        where: { id: row.secretId, userId: row.userId, spaceId: row.spaceId, kind: SECRET_KIND },
      });
    return this.owned(row.id, context, tx);
  }
  private async read(row: ConnectionRow, context: AdapterContext, tx: Prisma.TransactionClient) {
    const secret = row.secretId
      ? await tx.secret.findFirst({
          where: {
            id: row.secretId,
            userId: context.userId,
            spaceId: context.spaceId,
            kind: SECRET_KIND,
          },
        })
      : null;
    if (!secret) throw new IsolationError();
    const state = JSON.parse(this.deps.secrets.load(secret.ciphertext, secret.id)) as
      | Pending
      | TokenState;
    if (
      state.connectionId !== row.id ||
      state.userId !== context.userId ||
      state.spaceId !== context.spaceId ||
      state.installationId !== this.installationId ||
      state.provider !== row.provider
    )
      throw new IsolationError();
    return state;
  }
  private async markError(id: string, revision: number, context: AdapterContext) {
    await this.deps.prisma.connection.updateMany({
      where: { id, ...this.scope(context), revision, status: { not: "revoked" } },
      data: { status: "error", revision: { increment: 1 } },
    });
  }
  async revokeConnection(id: string, context: AdapterContext) {
    let revoked: TokenState | undefined;
    await this.deps.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM connections WHERE id = ${id} FOR UPDATE`;
      const row = await this.owned(id, context, tx);
      if (row.secretId) {
        const state = await this.read(row, context, tx).catch(() => null);
        if (state?.kind === "token") revoked = state;
      }
      await tx.connection.update({
        where: { id },
        data: {
          status: "revoked",
          secretId: null,
          providerRef: null,
          metadata: {},
          revision: { increment: 1 },
        },
      });
      await tx.botConnection.deleteMany({
        where: { connectionId: id, userId: context.userId, spaceId: context.spaceId },
      });
      if (row.secretId)
        await tx.secret.deleteMany({
          where: {
            id: row.secretId,
            userId: context.userId,
            spaceId: context.spaceId,
            kind: SECRET_KIND,
          },
        });
    });
    if (revoked?.viaBroker)
      await this.deps.broker
        ?.revoke?.({ provider: revoked.provider, ...revoked.tokens })
        .catch(() => undefined);
  }
  async begin(request: { provider: string; redirectUrl: string }, context: AdapterContext) {
    const result = await this.beginConnection(
      { ...request, displayName: request.provider },
      context,
    );
    return { authorizationUrl: result.authorizationUrl, state: result.authorizationId };
  }
  async complete(request: { state: string; code?: string }, context: AdapterContext) {
    const row = await this.deps.prisma.connection.findFirst({
      where: {
        ...this.scope(context),
        metadata: { path: ["authorizationId"], equals: request.state },
      },
    });
    if (!row) throw new IsolationError();
    await this.completeConnection(row.id, request.state, context, request.code);
    return { connectionRef: row.id };
  }
  async revoke(connectionRef: string, context: AdapterContext) {
    await this.revokeConnection(connectionRef, context);
  }
  private tool(
    row: Pick<ConnectionRow, "id" | "provider" | "displayName" | "metadata">,
    action: (typeof DIRECT_ACTIONS)[number],
  ): ConnectorTool {
    const generation = this.generation(row.metadata);
    const suffix = createHash("sha256")
      .update(`${row.id}:${generation}`)
      .digest("hex")
      .slice(0, 10);
    return {
      name: `direct_${row.provider}_${action.id}_${suffix}`,
      description: `${action.description} (${row.displayName})`,
      inputSchema: z.toJSONSchema(action.schema),
      readOnly: true,
      route: {
        connectorId: "direct",
        toolName: action.id,
        resourceId: row.id,
        resourceRevision: generation,
      },
    };
  }
  private generation(metadata: unknown): string {
    const id =
      metadata && typeof metadata === "object"
        ? (metadata as { authorizationId?: unknown }).authorizationId
        : undefined;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(id)) throw new IsolationError();
    return id;
  }
  listTools(row: Pick<ConnectionRow, "id" | "provider" | "displayName" | "metadata">) {
    return DIRECT_ACTIONS.filter((action) => action.provider === row.provider).map((action) =>
      this.tool(row, action),
    );
  }
  async discoverTools(context: AdapterContext) {
    if (!context.botId) return [];
    const rows = await this.deps.prisma.connection.findMany({
      where: {
        ...this.scope(context),
        status: "connected",
        botConnections: { some: { botId: context.botId } },
      },
    });
    return rows.flatMap((row) =>
      DIRECT_ACTIONS.filter((action) => action.provider === row.provider).map((action) =>
        this.tool(row, action),
      ),
    );
  }
  async resolveCall(call: ConnectorCall, context: AdapterContext) {
    if (!context.botId || call.route?.connectorId !== "direct" || !call.route.resourceId)
      return undefined;
    const row = await this.deps.prisma.connection.findFirst({
      where: {
        id: call.route.resourceId,
        ...this.scope(context),
        status: "connected",
        botConnections: { some: { botId: context.botId } },
      },
    });
    const action = DIRECT_ACTIONS.find(
      (item) => item.provider === row?.provider && item.id === call.route?.toolName,
    );
    if (!row || !action) return undefined;
    if (call.route.resourceRevision !== this.generation(row.metadata)) return undefined;
    const tool = this.tool(row, action);
    // The registry dispatches the static route name; direct callers use the public name.
    if (call.tool !== action.id && call.tool !== tool.name) return undefined;
    action.schema.parse(call.args);
    return { call, tool };
  }
  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    if (!context.botId || !call.route?.resourceId || call.route.connectorId !== "direct") {
      yield { type: "error", message: "This account is not assigned to this agent" };
      return;
    }
    let revision: number | undefined;
    try {
      const data = await this.deps.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM connections WHERE id = ${call.route!.resourceId!} FOR UPDATE`;
          const row = await this.owned(call.route!.resourceId!, context, tx);
          if (
            row.status !== "connected" ||
            !row.botConnections.some((grant) => grant.botId === context.botId)
          )
            throw new IsolationError();
          if (call.route!.resourceRevision !== this.generation(row.metadata))
            throw new IsolationError();
          const action = DIRECT_ACTIONS.find(
            (item) => item.provider === row.provider && item.id === call.route?.toolName,
          );
          if (!action || (call.tool !== action.id && call.tool !== this.tool(row, action).name))
            throw new IsolationError();
          const request = directActionRequest(directProvider(row.provider), action.id, call.args);
          const state = await this.read(row, context, tx);
          if (state.kind !== "token") throw new IsolationError();
          revision = row.revision;
          const material = directAppTokenSecrets(state.tokens);
          if (state.tokens.expiresAt && state.tokens.expiresAt <= Date.now() + 60_000) {
            if (!state.tokens.refreshToken) throw new Error("Reconnect this account");
            const previous = state.tokens;
            let renewed: DirectAppTokens;
            if (state.viaBroker)
              renewed = await this.deps.broker!.refresh({
                provider: state.provider,
                refreshToken: previous.refreshToken!,
                brokerCredential: previous.brokerCredential,
              });
            else {
              const clientId = state.clientId ?? this.clientId(state.provider);
              if (!clientId || (state.provider !== "github" && state.provider !== "microsoft"))
                throw new Error("Reconnect this account");
              const result = await directJson(
                this.fetcher,
                deviceEndpoints(state.provider).token,
                {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    client_id: clientId,
                    grant_type: "refresh_token",
                    refresh_token: previous.refreshToken!,
                  }).toString(),
                },
                context.signal,
              );
              if (result.status < 200 || result.status >= 300 || result.data.error)
                throw new Error("Reconnect this account");
              renewed = tokensFromResponse(result.data, previous);
            }
            renewed = Tokens.parse(renewed);
            if (!renewed.refreshToken) {
              renewed.refreshToken = previous.refreshToken;
              renewed.brokerCredential = previous.brokerCredential;
            }
            material.push(...directAppTokenSecrets(renewed));
            state.tokens = renewed;
            const updated = await this.save(tx, row, state, context);
            revision = updated.revision;
          }
          try {
            const result = await directJson(
              this.fetcher,
              request.url,
              {
                method: request.method,
                headers: directHeaders(state.provider, state.tokens.accessToken),
                ...(request.body ? { body: request.body } : {}),
              },
              context.signal,
            );
            if (
              result.status < 200 ||
              result.status >= 300 ||
              result.data.ok === false ||
              result.data.errors
            )
              return {
                ok: false as const,
                reconnect: result.status === 401 || result.status === 403,
              };
            return { ok: true as const, data: redactConnectorPayload(result.data, material) };
          } catch {
            return { ok: false as const, reconnect: false };
          }
        },
        { timeout: 30_000 },
      );
      if (data.ok) yield { type: "result", data: data.data };
      else {
        if (data.reconnect && revision !== undefined)
          await this.markError(call.route.resourceId, revision, context);
        yield {
          type: "error",
          message: data.reconnect
            ? "This account needs to be reconnected"
            : "The app request failed. Try again.",
        };
      }
    } catch (error) {
      if (
        revision !== undefined &&
        !(error instanceof IsolationError) &&
        !(error instanceof z.ZodError)
      )
        await this.markError(call.route.resourceId, revision, context);
      yield {
        type: "error",
        message:
          error instanceof IsolationError
            ? "This account is no longer assigned or connected"
            : error instanceof z.ZodError
              ? "Invalid app action arguments"
              : "The app request failed. Reconnect this account if it needs attention.",
      };
    }
  }
}
