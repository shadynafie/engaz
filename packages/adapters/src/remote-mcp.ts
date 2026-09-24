import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import type { ConnectorTool } from "@engaz/adapter-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent, fetch as undiciFetch } from "undici";
import { combineSignals } from "./connector-safety.js";
import {
  createAddressCheckedLookup,
  isCloudMetadataAddress,
  isLocalNetworkAddress,
  isPrivateAddress,
  isTailscaleAddress,
  type ResolvedAddress,
  type ResolveHostname,
  withPinnedDnsLookup,
} from "./network-address.js";

const MAX_MCP_TOOLS = 250;
const MAX_MCP_PAGES = 20;
const MCP_TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 1_000_000;

export type { ResolveHostname } from "./network-address.js";

export interface RemoteTransportDependencies {
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
}

export interface RemoteMcpOptions extends RemoteTransportDependencies {
  endpoint: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SafeRemoteFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

const resolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function listRemoteMcpTools(options: RemoteMcpOptions): Promise<ConnectorTool[]> {
  return withRemoteMcpClient(options, async (client, signal) => {
    const tools: ConnectorTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MCP_PAGES && tools.length < MAX_MCP_TOOLS; page += 1) {
      const result = await client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: MCP_TIMEOUT_MS,
      });
      for (const tool of result.tools) {
        if (tools.length >= MAX_MCP_TOOLS) break;
        tools.push({
          name: tool.name,
          description: tool.description ?? tool.title ?? tool.name,
          inputSchema: tool.inputSchema,
          readOnly: tool.annotations?.readOnlyHint,
        });
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools;
  });
}

export async function callRemoteMcpTool(
  options: RemoteMcpOptions,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return withRemoteMcpClient(options, async (client, signal) => {
    const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
      signal,
      timeout: MCP_TIMEOUT_MS,
    });
    return limitRemoteMcpPayload({
      content: result.content,
      structuredContent: result.structuredContent,
      isError: result.isError ?? false,
      _meta: result._meta,
    });
  });
}

async function withRemoteMcpClient<T>(
  options: RemoteMcpOptions,
  run: (client: Client, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const endpoint = await assertSafeRemoteUrl(
    options.endpoint,
    options.resolveHostname ?? resolveHostname,
  );
  const signal = combineSignals(options.signal, AbortSignal.timeout(MCP_TIMEOUT_MS));
  const safeFetch = createSafeRemoteFetch(
    options.fetch,
    options.resolveHostname ?? resolveHostname,
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: options.headers,
      redirect: "manual",
      signal,
    },
    fetch: safeFetch,
  });
  const client = new Client({ name: "engaz", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport, { signal, timeout: MCP_TIMEOUT_MS });
    return await run(client, signal);
  } finally {
    await client.close().catch(() => undefined);
    await safeFetch.close().catch(() => undefined);
  }
}

export async function assertSafeRemoteUrl(
  value: string,
  resolve: ResolveHostname = resolveHostname,
): Promise<URL> {
  return (await inspectSafeRemoteUrl(value, resolve)).url;
}

async function inspectSafeRemoteUrl(
  value: string,
  resolve: ResolveHostname,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Connector URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("Connector URL must use HTTPS");
  if (url.username || url.password) throw new Error("Connector URL must not contain credentials");
  if (url.hash) throw new Error("Connector URL must not contain a fragment");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateHostname(hostname)) throw new Error("Connector URL targets a private host");
  const addresses = await resolve(hostname);
  assertPublicAddresses(addresses, hostname);
  return { url, addresses };
}

/** Drive the package `Agent` with that same undici's fetch. Node 22's
 * built-in fetch is an older undici major, so handing it a package Agent as
 * `dispatcher` throws `invalid onRequestStart` before any socket opens.
 * Captured Node fetch is paired the same way. Injected fetches are not given
 * that Agent; they keep the original hostname for TLS/SNI and pin TCP to the
 * already-validated address through `dns.lookup`. */
const packageFetch = undiciFetch as unknown as typeof globalThis.fetch;
const nodeFetch = globalThis.fetch;

function requestInitWithHost(url: URL, init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  return { ...init, headers };
}

export function createSafeRemoteFetch(
  baseFetch?: typeof globalThis.fetch,
  resolve: ResolveHostname = resolveHostname,
): SafeRemoteFetch {
  return createPinnedFetch(
    (value) => inspectSafeRemoteUrl(value, resolve),
    createSafeLookup(resolve),
    baseFetch,
  );
}

/** For a server the owner saved as being on their own network: HTTP is allowed,
 * and every connection is pinned to local addresses, so a later DNS answer
 * cannot turn it into a request to the internet or to cloud metadata. */
export function createLocalNetworkFetch(
  baseFetch?: typeof globalThis.fetch,
  resolve: ResolveHostname = resolveHostname,
): SafeRemoteFetch {
  return createPinnedFetch(
    (value) => inspectLocalNetworkUrl(value, resolve),
    createAddressCheckedLookup(
      (hostname) => resolveEndpointHost(hostname, resolve),
      assertLocalNetworkAddresses,
    ),
    baseFetch,
  );
}

function createPinnedFetch(
  inspect: (value: string) => Promise<{ url: URL; addresses: ResolvedAddress[] }>,
  lookup: LookupFunction,
  baseFetch?: typeof globalThis.fetch,
): SafeRemoteFetch {
  const dispatcher = new Agent({ connect: { lookup } });
  const usePackageFetch =
    baseFetch == null || baseFetch === nodeFetch || baseFetch === packageFetch;
  const safeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input !== "string" && !(input instanceof URL)) {
      throw new Error("Connector fetch requires a URL, not a Request");
    }
    const { url, addresses } = await inspect(String(input));
    let response: Response;
    try {
      const requestInit = { ...init, redirect: "manual" as const };
      response = usePackageFetch
        ? await packageFetch(url, {
            ...requestInit,
            dispatcher,
          } as RequestInit & { dispatcher: Agent })
        : await withPinnedDnsLookup(url.hostname, addresses, () =>
            baseFetch!(url, requestInitWithHost(url, requestInit)),
          );
    } catch (error) {
      const detail = transportFailureDetail(error);
      throw new Error(`Could not reach ${url.host}${detail ? `: ${detail}` : ""}`, {
        cause: error,
      });
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Connector redirects are not allowed");
    }
    return response;
  };
  const result = safeFetch as SafeRemoteFetch;
  result.close = () => dispatcher.close();
  return result;
}

export type EndpointNetwork = "internet" | "local";

/** Where an endpoint's host is right now: on the internet, or on the owner's own
 * machine or network. Anything else (cloud metadata, link-local, a mix) is refused. */
export async function endpointNetwork(
  endpoint: string,
  resolve: ResolveHostname = resolveHostname,
): Promise<EndpointNetwork> {
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolveEndpointHost(hostname, resolve);
  if (!isPrivateHostname(hostname)) {
    try {
      assertPublicAddresses(addresses, hostname);
      return "internet";
    } catch {
      /* Not public; it may still be local. */
    }
  }
  assertLocalNetworkAddresses(addresses);
  return "local";
}

/** IP literals need no lookup, and `localhost` is loopback by definition (RFC 6761). */
async function resolveEndpointHost(
  hostname: string,
  resolve: ResolveHostname,
): Promise<ResolvedAddress[]> {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const family = isIP(normalized);
  if (family !== 0) return [{ address: normalized, family }];
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return [{ address: "127.0.0.1", family: 4 }];
  }
  return resolve(normalized);
}

async function inspectLocalNetworkUrl(
  value: string,
  resolve: ResolveHostname,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Connector URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Connector URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) throw new Error("Connector URL must not contain credentials");
  if (url.hash) throw new Error("Connector URL must not contain a fragment");
  const addresses = await resolveEndpointHost(url.hostname, resolve);
  assertLocalNetworkAddresses(addresses);
  return { url, addresses };
}

function assertLocalNetworkAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0 || !addresses.every((entry) => isLocalNetworkAddress(entry.address))) {
    throw new Error("Connector URL resolves to a private address");
  }
}

const MAX_CAUSE_DEPTH = 5;

/** undici reports refused ports, unreachable hosts, DNS misses and TLS errors
 * alike as `TypeError: fetch failed` and keeps the actionable reason in `cause`
 * (or in the per-address errors of a happy-eyeballs AggregateError). */
function transportFailureDetail(error: unknown, depth = 0): string | undefined {
  if (depth >= MAX_CAUSE_DEPTH || !(error instanceof Error)) return undefined;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const detail = transportFailureDetail(inner, depth + 1);
      if (detail) return detail;
    }
  }
  return (
    transportFailureDetail(error.cause, depth + 1) ??
    (error.message === "fetch failed" ? undefined : error.message)
  );
}

export function createSafeLookup(resolve: ResolveHostname = resolveHostname): LookupFunction {
  return createAddressCheckedLookup(resolve, assertPublicAddresses);
}

/** Tailscale MagicDNS names (*.ts.net) are public DNS names, not private IP literals. */
function isTailscaleMagicDnsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "ts.net" || normalized.endsWith(".ts.net");
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (isTailscaleMagicDnsHostname(normalized)) return false;
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal" ||
    (isIP(normalized) !== 0 && isPrivateAddress(normalized))
  );
}

function assertPublicAddresses(addresses: ResolvedAddress[], hostname?: string): void {
  if (addresses.length === 0) {
    throw new Error("Connector URL resolves to a private address");
  }
  const magicDns = hostname != null && isTailscaleMagicDnsHostname(hostname);
  if (
    addresses.some((entry) => {
      if (isCloudMetadataAddress(entry.address)) return true;
      if (!isPrivateAddress(entry.address)) return false;
      // Allow only Tailscale ranges for MagicDNS; keep other private ranges blocked.
      return !(magicDns && isTailscaleAddress(entry.address));
    })
  ) {
    throw new Error("Connector URL resolves to a private address");
  }
}

export function limitRemoteMcpPayload(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.byteLength <= MAX_RESULT_BYTES) return value;
  return {
    truncated: true,
    content: decodeUtf8Prefix(bytes, MAX_RESULT_BYTES),
  };
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.min(bytes.byteLength, maxBytes);
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}
