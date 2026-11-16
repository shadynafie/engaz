import type {
  Bot,
  CapabilityInstall,
  Connection,
  ConnectionCatalogItem,
  IntegrationCatalogResult,
  IntegrationCatalogSurface,
  McpServer,
} from "@engaz/contracts";
import {
  abortableDelay,
  buildFeaturedConnectorTiles,
  CONNECTION_CATALOG_PAGE_SIZE,
  filterConnectionCatalogItems,
  humanizeToolName,
} from "@engaz/core";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@engaz/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Check, ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PluginStatus } from "../components/PluginStatus";
import { optionalCatalogFeedProbe } from "../lib/optional-catalog-feed";
import { rpc } from "../lib/rpc";

type SourceKind = "api" | "graphql";

/** What the MCP servers screen opens with when a preset or catalog result starts it. */
export type McpServerDraft = { name: string; endpoint: string; needsToken?: boolean };

type ConnectionTool = { name: string; description: string };

function itemKey(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
  return `${item.connectorId}:${item.slug}`;
}

function markConnected(
  items: ConnectionCatalogItem[],
  connectorId: string,
  slug: string,
  connected: boolean,
) {
  return items.map((entry) =>
    entry.connectorId === connectorId && entry.slug === slug ? { ...entry, connected } : entry,
  );
}

function activeAccounts(
  connections: Connection[],
  item: Pick<ConnectionCatalogItem, "connectorId" | "slug">,
) {
  return connections.filter(
    (row) =>
      row.connectorId === item.connectorId &&
      row.provider === item.slug &&
      row.status !== "revoked",
  );
}

function nextAccountLabel(itemName: string, existingCount: number) {
  return existingCount <= 0 ? itemName : `${itemName} ${existingCount + 1}`;
}
export function PluginsOverlay({ onOpenMcp }: { onOpenMcp?: (draft?: McpServerDraft) => void }) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(CONNECTION_CATALOG_PAGE_SIZE);
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">("bearer");
  const [authName, setAuthName] = useState("x-api-key");
  const [pending, setPending] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [catalogFeedEnabled, setCatalogFeedEnabled] = useState(false);
  const [catalogFeedQuery, setCatalogFeedQuery] = useState("");
  const [catalogFeedResults, setCatalogFeedResults] = useState<IntegrationCatalogResult[]>([]);
  const [catalogFeedError, setCatalogFeedError] = useState<string | null>(null);
  const [catalogFeedPending, setCatalogFeedPending] = useState(false);
  const [catalogFeedSearched, setCatalogFeedSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailKey, setDetailKey] = useState<{ connectorId: string; slug: string } | null>(null);
  const [tools, setTools] = useState<ConnectionTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [devicePrompt, setDevicePrompt] = useState<{
    userCode?: string;
    verificationUri?: string;
  } | null>(null);
  const [toolsTick, setToolsTick] = useState(0);
  const connectionAttempt = useRef<AbortController | null>(null);

  async function refresh() {
    const [items, installs, rows, catalogFeed, botList, servers] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.capabilities.list().catch(() => {
        setSourceError(t`Could not load tool sources`);
        return null;
      }),
      rpc.connections.list(),
      optionalCatalogFeedProbe(rpc.capabilities.catalogSearch({ query: "" })),
      rpc.bots.list(),
      rpc.mcp.servers.list().catch(() => {
        setSourceError(t`Could not load MCP servers`);
        return null;
      }),
    ]);
    setBots(botList.filter((bot) => !bot.archivedAt));
    if (servers) setMcpServers(servers);
    setCatalog([
      ...items,
      ...rows
        .filter(
          (row) =>
            row.status !== "revoked" &&
            !items.some(
              (item) => item.connectorId === row.connectorId && item.slug === row.provider,
            ),
        )
        .map((row) => ({
          connectorId: row.connectorId,
          slug: row.provider,
          name: row.displayName,
          logo: null,
          connected: row.status === "connected",
          noAuth: false,
          available: false,
          setupRequired: true,
        })),
    ]);
    setConnections(rows);
    setLabelDrafts((current) => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (row.status === "connected" || row.status === "pending") {
          next[row.id] = current[row.id] ?? row.displayName;
        }
      }
      return next;
    });
    if (installs)
      setSources(
        installs.filter(
          (install) =>
            install.kind === "mcp" || install.kind === "api" || install.kind === "graphql",
        ),
      );
    setCatalogFeedEnabled(catalogFeed.enabled);
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setCatalogError(err instanceof Error ? err.message : t`Could not load connections`),
      )
      .finally(() => setLoading(false));
    return () => connectionAttempt.current?.abort();
  }, []);

  const detailItem = useMemo(() => {
    if (!detailKey) return null;
    return (
      catalog.find(
        (entry) => entry.connectorId === detailKey.connectorId && entry.slug === detailKey.slug,
      ) ?? null
    );
  }, [catalog, detailKey]);

  useEffect(() => {
    if (!detailKey) {
      setTools([]);
      setToolsLoading(false);
      return;
    }
    let cancelled = false;
    setToolsLoading(true);
    void rpc.connections
      .tools({ connectorId: detailKey.connectorId, provider: detailKey.slug })
      .then((list) => {
        if (!cancelled) setTools(list);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailKey, toolsTick]);

  const showFeatured = !query.trim();
  // Featured apps this catalog lacks are left out rather than shown disabled.
  const featuredTiles = useMemo(
    () =>
      buildFeaturedConnectorTiles(
        catalog.filter((item) => item.connectorId === "direct" && item.available !== false),
      ).filter((tile) => tile.item && !tile.missing),
    [catalog],
  );
  const featured = showFeatured ? featuredTiles.map((tile) => tile.item!) : [];
  const featuredLabels = new Map(featuredTiles.map((tile) => [itemKey(tile.item!), tile.label]));

  const visible = useMemo(
    () =>
      filterConnectionCatalogItems(
        catalog.filter(
          (item) =>
            item.connectorId === "direct" &&
            (item.available !== false || activeAccounts(connections, item).length > 0),
        ),
        query,
      ),
    [catalog, connections, query],
  );
  const rendered = visible.slice(0, visibleCount);

  function openDetail(item: ConnectionCatalogItem) {
    setCatalogError(null);
    setToolsOpen(false);
    setDetailKey({ connectorId: item.connectorId, slug: item.slug });
  }

  function closeDetail() {
    setDetailKey(null);
    setTools([]);
  }

  function itemConnected(item: ConnectionCatalogItem) {
    return (
      item.connected || activeAccounts(connections, item).some((row) => row.status === "connected")
    );
  }

  function setItemConnected(item: ConnectionCatalogItem, connected: boolean) {
    setCatalog((prev) => markConnected(prev, item.connectorId, item.slug, connected));
  }

  async function connect(item: ConnectionCatalogItem, account?: Connection) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setCatalogError(null);
    setDevicePrompt(null);
    const key = itemKey(item);
    setPending(key);
    // Reserve the window during the click so slow requests do not lose popup permission.
    const popup = item.noAuth ? null : window.open("about:blank", "engaz-plugin-connect");
    if (popup) popup.opener = null;
    try {
      const existing = activeAccounts(connections, item).filter(
        (row) => row.status === "connected",
      );
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName: account?.displayName ?? nextAccountLabel(item.name, existing.length),
        ...(account ? { connectionId: account.id } : {}),
      });
      if (started.userCode || started.verificationUri)
        setDevicePrompt({ userCode: started.userCode, verificationUri: started.verificationUri });
      if (started.authorizationUrl) {
        if (!popup) {
          window.location.assign(started.authorizationUrl);
          return;
        }
        popup.location.replace(started.authorizationUrl);
      } else {
        popup?.close();
      }
      const expires = started.expiresAt ? Date.parse(started.expiresAt) : Date.now() + 10 * 60_000;
      while (Date.now() < expires) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({
            connectionId: started.connectionId,
            authorizationId: started.authorizationId,
          })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          setDevicePrompt(null);
          setItemConnected(item, true);
          await refresh().catch(() => undefined);
          setToolsTick((tick) => tick + 1);
          return;
        }
        await abortableDelay(
          Math.max(1, started.pollIntervalSeconds ?? 2) * 1_000,
          controller.signal,
        );
      }
      if (controller.signal.aborted) return;
      setDevicePrompt(null);
      setCatalogError(
        t`Connection to ${item.name} is still pending. You can close this and check again.`,
      );
      await refresh().catch(() => undefined);
    } catch (err) {
      popup?.close();
      if (controller.signal.aborted) return;
      setCatalogError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
      }
    }
  }

  async function revokeAccount(row: Connection, item: ConnectionCatalogItem) {
    setCatalogError(null);
    setPending(row.id);
    try {
      await rpc.connections.revoke({ connectionId: row.id });
      const remaining = activeAccounts(connections, item).filter((entry) => entry.id !== row.id);
      if (remaining.every((entry) => entry.status !== "connected")) {
        setItemConnected(item, false);
      }
      await refresh().catch(() => undefined);
      setToolsTick((tick) => tick + 1);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  async function toggleAccountAgent(row: Connection, botId: string) {
    if (pending) return;
    setPending(`agents:${row.id}`);
    setCatalogError(null);
    try {
      const updated = await rpc.connections.setAgents({
        connectionId: row.id,
        botIds: row.agentIds.includes(botId)
          ? row.agentIds.filter((id) => id !== botId)
          : [...row.agentIds, botId],
      });
      setConnections((current) => current.map((entry) => (entry.id === row.id ? updated : entry)));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : t`Could not update agent access`);
    } finally {
      setPending(null);
    }
  }

  async function renameAccount(row: Connection) {
    const displayName = (labelDrafts[row.id] ?? row.displayName).trim();
    if (!displayName || displayName === row.displayName) return;
    setPending(`rename:${row.id}`);
    setCatalogError(null);
    try {
      const updated = await rpc.connections.rename({ connectionId: row.id, displayName });
      setConnections((current) =>
        current.map((entry) =>
          entry.id === row.id ? { ...entry, displayName: updated.displayName } : entry,
        ),
      );
      setLabelDrafts((current) => ({ ...current, [row.id]: updated.displayName }));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not rename connection`);
    } finally {
      setPending(null);
    }
  }

  function beginSource(kind: SourceKind) {
    setSourceKind(kind);
    setSourceError(null);
    setSourceHint(null);
    setSourceName("");
    setSourceUrl("");
    setCredential("");
    setAuthType("none");
    setAuthName("x-api-key");
  }

  async function searchCatalogFeed() {
    setCatalogFeedError(null);
    setCatalogFeedPending(true);
    setCatalogFeedSearched(false);
    setCatalogFeedResults([]);
    try {
      const response = await rpc.capabilities.catalogSearch({ query: catalogFeedQuery });
      setCatalogFeedResults(response.results);
      setCatalogFeedSearched(true);
    } catch (err) {
      setCatalogFeedError(err instanceof Error ? err.message : t`Could not search catalog`);
    } finally {
      setCatalogFeedPending(false);
    }
  }

  function beginCatalogSurface(
    result: IntegrationCatalogResult,
    surface: IntegrationCatalogSurface,
  ) {
    if (!surface.source || (surface.kind !== "mcp" && surface.kind !== "openapi")) return;
    // MCP servers all live on one screen, with their status and per-agent tools.
    if (surface.kind === "mcp") {
      onOpenMcp?.({
        name: result.name,
        endpoint: surface.source,
        needsToken: (surface.auth?.type ?? "none") !== "none",
      });
      return;
    }
    setSourceKind("api");
    setSourceName(result.name);
    setSourceUrl(surface.source);
    setCredential("");
    setAuthType(surface.auth?.type ?? "none");
    setAuthName(surface.auth?.headerName ?? "x-api-key");
    setSourceHint(surface.auth?.note ?? null);
    setSourceError(null);
  }

  async function installSource() {
    if (!sourceKind) return;
    setSourceError(null);
    setPending("install-source");
    try {
      const auth = {
        type: authType,
        ...(authType === "header" ? { name: authName.trim() } : {}),
      };
      await rpc.capabilities.install({
        kind: sourceKind,
        name: sourceName.trim() || (sourceKind === "graphql" ? "GraphQL" : "Custom connector"),
        source: sourceUrl.trim(),
        credential: credential.trim() || undefined,
        config: sourceKind === "api" ? { openApi: true, auth } : { auth },
      });
      setCredential("");
      setSourceKind(null);
      await refresh();
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not install connector`);
    } finally {
      setPending(null);
    }
  }

  function replaceSource(updated: CapabilityInstall) {
    setSources((current) => current.map((source) => (source.id === updated.id ? updated : source)));
  }

  async function checkSource(install: CapabilityInstall) {
    setPending(`check:${install.id}`);
    setSourceError(null);
    try {
      replaceSource(await rpc.capabilities.check({ id: install.id }));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not check this source`);
    } finally {
      setPending(null);
    }
  }

  /** Every agent until the owner narrows it; after that, exactly the agents chosen. */
  async function toggleSourceAgent(install: CapabilityInstall, botId: string) {
    const current = install.agentIds ?? bots.map((bot) => bot.id);
    const agentIds = current.includes(botId)
      ? current.filter((id) => id !== botId)
      : [...current, botId];
    setSourceError(null);
    try {
      replaceSource(await rpc.capabilities.setAgents({ id: install.id, agentIds }));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not update agent access`);
    }
  }

  async function removeSource(install: CapabilityInstall) {
    setPending(install.id);
    setSourceError(null);
    try {
      await rpc.capabilities.remove({ id: install.id });
      setSources((current) => current.filter((source) => source.id !== install.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  function renderCatalogActions(item: ConnectionCatalogItem) {
    const key = itemKey(item);
    const connected = itemConnected(item);
    const saved = activeAccounts(connections, item).length > 0;
    const connecting = pending === key;
    if (!connected && !saved && item.available === false) return null;
    if (connected || saved) {
      return (
        <Button
          type="button"
          variant="secondary"
          className="rounded-full"
          size="sm"
          disabled={connecting}
          onClick={(event) => {
            event.stopPropagation();
            openDetail(item);
          }}
        >
          {connecting ? (
            <Trans>Connecting…</Trans>
          ) : connected ? (
            <Trans>Connected</Trans>
          ) : (
            <Trans>Manage</Trans>
          )}
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="secondary"
        className="rounded-full"
        size="sm"
        disabled={pending !== null}
        onClick={(event) => {
          event.stopPropagation();
          void connect(item);
        }}
      >
        {connecting ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
      </Button>
    );
  }

  function renderCatalogTile(
    item: ConnectionCatalogItem,
    label: string,
    logo?: string | null,
    opts?: { tileTestId?: boolean },
  ) {
    const connected = itemConnected(item);
    const tileTestId = opts?.tileTestId !== false && connected;
    const icon = logo ? (
      <img
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-9 w-9 shrink-0 rounded-xl bg-accent object-contain"
      />
    ) : (
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-foreground">
        {label[0]}
      </div>
    );
    const title = (
      <div className="min-w-0 flex-1 text-start">
        <div className="truncate text-[15px] font-medium text-foreground">{label}</div>
      </div>
    );
    return (
      <div
        key={itemKey(item)}
        data-testid={tileTestId ? `connection-tile-${item.slug.toLowerCase()}` : undefined}
        className="flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2"
      >
        {connected || activeAccounts(connections, item).length > 0 ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-start hover:bg-accent/60"
            onClick={() => openDetail(item)}
          >
            {icon}
            {title}
          </button>
        ) : (
          <>
            {icon}
            {title}
          </>
        )}
        {renderCatalogActions(item)}
      </div>
    );
  }

  function renderDetail(item: ConnectionCatalogItem) {
    const accounts = activeAccounts(connections, item);
    const connecting = pending === itemKey(item);
    const toolCount = tools.length;

    return (
      <div data-testid="connection-detail" className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={t`Back`}
              onClick={closeDetail}
            >
              <ChevronLeft />
            </Button>
            {item.logo ? (
              <img
                src={item.logo}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-9 w-9 shrink-0 rounded-xl bg-accent object-contain"
              />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-foreground">
                {item.name[0]}
              </div>
            )}
            <div className="truncate text-[17px] font-medium text-foreground">{item.name}</div>
          </div>
        </div>

        <Card data-testid="connection-accounts">
          <CardHeader>
            <CardTitle>
              <Trans>Accounts</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {accounts.map((row) => (
              <div key={row.id} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    value={labelDrafts[row.id] ?? row.displayName}
                    aria-label={t`Account label`}
                    className="min-w-0 flex-1"
                    disabled={pending !== null}
                    onChange={(event) =>
                      setLabelDrafts((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    onBlur={() => void renameAccount(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending !== null}
                    onClick={() => void revokeAccount(row, item)}
                  >
                    <Trans>Disconnect</Trans>
                  </Button>
                </div>
                {row.accountLabel ? (
                  <p className="break-words text-sm text-foreground">{row.accountLabel}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {row.status === "connected" ? (
                    <Trans>Connected</Trans>
                  ) : row.status === "pending" ? (
                    <Trans>Sign-in pending</Trans>
                  ) : (
                    <Trans>Needs attention</Trans>
                  )}
                </p>
                {
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending !== null || item.available === false}
                    onClick={() => void connect(item, row)}
                  >
                    <Trans>Reconnect</Trans>
                  </Button>
                }
                <details>
                  <summary className="cursor-pointer text-sm">
                    <Trans>Agents</Trans>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {bots.map((bot) => (
                      <label
                        key={bot.id}
                        htmlFor={`connection-${row.id}-${bot.id}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          id={`connection-${row.id}-${bot.id}`}
                          checked={row.agentIds.includes(bot.id)}
                          disabled={pending !== null}
                          onCheckedChange={() => void toggleAccountAgent(row, bot.id)}
                        />
                        {bot.name}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              size="sm"
              disabled={pending !== null || item.available === false}
              onClick={() => void connect(item)}
            >
              {connecting ? <Trans>Adding…</Trans> : <Trans>Add another</Trans>}
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="connection-tools">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            onClick={() => setToolsOpen((open) => !open)}
            aria-expanded={toolsOpen}
          >
            <span className="text-base font-medium text-foreground">
              {toolsLoading ? (
                <Trans>Tools</Trans>
              ) : (
                <Plural value={toolCount} one="# tool" other="# tools" />
              )}
            </span>
            {toolsOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>
          {toolsOpen ? (
            <CardContent className="border-t border-border pt-3">
              {toolsLoading ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>Loading tools…</Trans>
                </p>
              ) : tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>No tools available.</Trans>
                </p>
              ) : (
                <ul className="space-y-2">
                  {tools.map((tool) => (
                    <li key={tool.name} className="text-sm text-foreground">
                      {humanizeToolName(tool.name)}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="connections-settings" className="min-w-0">
      {!detailItem &&
      catalog.some(
        (item) =>
          item.connectorId === "direct" &&
          (item.available !== false || activeAccounts(connections, item).length > 0),
      ) ? (
        <div className="pb-4">
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(CONNECTION_CATALOG_PAGE_SIZE);
            }}
            aria-label={t`Search apps`}
            placeholder={t`Search apps`}
            className="h-11 rounded-xl px-4 md:text-[15px]"
          />
        </div>
      ) : null}

      <div id="integration-list" className="min-w-0">
        {catalogError ? <p className="mb-4 text-sm text-destructive">{catalogError}</p> : null}
        {devicePrompt ? (
          <div role="status" className="mb-4 space-y-2 rounded-lg border border-border p-3">
            {devicePrompt.userCode ? (
              <>
                <p className="text-sm">
                  <Trans>Enter this code</Trans>
                </p>
                <code className="select-all text-lg">{devicePrompt.userCode}</code>
              </>
            ) : null}
            {devicePrompt.verificationUri ? (
              <a
                href={devicePrompt.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="block text-sm underline"
              >
                <Trans>Open sign-in page</Trans>
              </a>
            ) : null}
          </div>
        ) : null}

        {detailItem ? (
          renderDetail(detailItem)
        ) : (
          <>
            {loading ? (
              <p className="text-muted-foreground/80">
                <Trans>Loading connections…</Trans>
              </p>
            ) : null}

            {!loading && catalog.length === 0 ? (
              <p className="text-[13.5px] leading-6 text-muted-foreground/80">
                <Trans>
                  Apps are not available on this installation. You can still add a connection under
                  Advanced.
                </Trans>
              </p>
            ) : null}
            {!loading && catalog.length > 0 && visible.length === 0 && !showFeatured ? (
              <p className="text-muted-foreground/80">
                <Trans>No apps match your search.</Trans>
              </p>
            ) : null}
            {/* Featured apps lead the same grid as the rest of the catalog. */}
            {featured.length > 0 || visible.length > 0 ? (
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                data-testid={showFeatured ? "featured-connectors" : undefined}
              >
                {featured.map((item) =>
                  renderCatalogTile(
                    item,
                    featuredLabels.get(itemKey(item)) ?? item.name,
                    item.logo,
                  ),
                )}
                {rendered.map((item) =>
                  renderCatalogTile(item, item.name, item.logo, {
                    // Avoid duplicate connection-tile-* ids while featured is also shown.
                    tileTestId: !showFeatured,
                  }),
                )}
              </div>
            ) : null}
            {rendered.length < visible.length ? (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full"
                  size="sm"
                  onClick={() => setVisibleCount((count) => count + CONNECTION_CATALOG_PAGE_SIZE)}
                >
                  <Trans>Show more</Trans>
                </Button>
              </div>
            ) : null}

            <details
              data-testid="integrations-advanced"
              className="group mt-8"
              onToggle={(event) => {
                if (!(event.currentTarget as HTMLDetailsElement).open) {
                  setSourceKind(null);
                  setSourceError(null);
                  setSourceHint(null);
                  setSourceName("");
                  setSourceUrl("");
                  setCredential("");
                  setAuthType("none");
                  setAuthName("x-api-key");
                }
              }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] text-muted-foreground">
                <span className="text-muted-foreground">
                  <Trans>Advanced</Trans>
                </span>
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>

              <div className="mt-4 space-y-4">
                {catalog.some(
                  (item) =>
                    item.connectorId !== "direct" && activeAccounts(connections, item).length > 0,
                ) ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">
                      <Trans>Saved connections</Trans>
                    </h3>
                    {catalog
                      .filter(
                        (item) =>
                          item.connectorId !== "direct" &&
                          activeAccounts(connections, item).length > 0,
                      )
                      .map((item) => renderCatalogTile(item, item.name, item.logo))}
                  </div>
                ) : null}
                {onOpenMcp ? (
                  <button
                    type="button"
                    data-testid="integrations-mcp"
                    onClick={() => onOpenMcp()}
                    className="mb-6 flex w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-start hover:bg-accent"
                  >
                    <span>
                      <span className="block text-[15px] font-medium text-foreground">
                        <Trans>MCP servers</Trans>
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {mcpServers.length === 0 ? (
                          <Trans>Connect tools from a server on the internet or your network</Trans>
                        ) : mcpServers.some((server) => server.check.status !== "working") ? (
                          <Plural
                            value={
                              mcpServers.filter((server) => server.check.status !== "working")
                                .length
                            }
                            one="# needs attention"
                            other="# need attention"
                          />
                        ) : (
                          <Plural value={mcpServers.length} one="# working" other="# working" />
                        )}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      ›
                    </span>
                  </button>
                ) : null}

                {catalogFeedEnabled ? (
                  <Card data-testid="integrations-catalog-feed">
                    <CardHeader>
                      <CardTitle>
                        <Trans>Search by domain</Trans>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void searchCatalogFeed();
                        }}
                      >
                        <Input
                          value={catalogFeedQuery}
                          disabled={catalogFeedPending}
                          onChange={(event) => {
                            setCatalogFeedQuery(event.target.value);
                            setCatalogFeedResults([]);
                            setCatalogFeedError(null);
                            setCatalogFeedSearched(false);
                          }}
                          placeholder="github.com"
                          aria-label={t`Integration domain`}
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          className="rounded-full"
                          size="sm"
                          disabled={!catalogFeedQuery.trim() || catalogFeedPending}
                        >
                          {catalogFeedPending ? <Trans>Searching…</Trans> : <Trans>Search</Trans>}
                        </Button>
                      </form>
                      {catalogFeedError ? (
                        <p className="text-sm text-destructive">{catalogFeedError}</p>
                      ) : null}
                      {catalogFeedSearched &&
                      !catalogFeedPending &&
                      catalogFeedResults.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          <Trans>No results</Trans>
                        </p>
                      ) : null}
                      {catalogFeedResults.map((result) => (
                        <div
                          key={`${result.domain}:${result.name}:${result.pageUrl ?? ""}`}
                          className="rounded-xl border border-border/70 p-3"
                        >
                          <div className="font-medium text-foreground">
                            {result.pageUrl ? (
                              <a
                                href={result.pageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline"
                              >
                                {result.name}
                              </a>
                            ) : (
                              result.name
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{result.domain}</div>
                          {result.description ? (
                            <p className="mt-2 text-sm leading-5 text-muted-foreground">
                              {result.description}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {result.surfaces.map((surface) => {
                              const canAdd =
                                Boolean(surface.source) &&
                                (surface.kind === "mcp" || surface.kind === "openapi");
                              return (
                                <Button
                                  key={`${result.domain}:${surface.slug}`}
                                  type="button"
                                  variant="secondary"
                                  className="rounded-full"
                                  size="sm"
                                  disabled={!canAdd}
                                  title={canAdd ? undefined : t`Manual setup required`}
                                  onClick={() => beginCatalogSurface(result, surface)}
                                >
                                  {surface.kind.toUpperCase()} · {canAdd ? t`Add` : t`Manual`}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                <div data-testid="integrations-advanced-add" className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    size="sm"
                    onClick={() => beginSource("api")}
                  >
                    <Trans>Add OpenAPI</Trans>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    size="sm"
                    onClick={() => beginSource("graphql")}
                  >
                    <Trans>Add GraphQL</Trans>
                  </Button>
                </div>

                {sourceError ? <p className="text-sm text-destructive">{sourceError}</p> : null}

                {sourceKind ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {sourceKind === "graphql" ? (
                          <Trans>Add GraphQL endpoint</Trans>
                        ) : (
                          <Trans>Import OpenAPI JSON</Trans>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Input
                        value={sourceName}
                        onChange={(event) => setSourceName(event.target.value)}
                        placeholder={t`Display name`}
                      />
                      <Input
                        value={sourceUrl}
                        onChange={(event) => setSourceUrl(event.target.value)}
                        placeholder={
                          sourceKind === "graphql"
                            ? "https://example.com/graphql"
                            : "https://example.com/openapi.json"
                        }
                      />
                      <NativeSelect
                        className="w-full"
                        value={authType}
                        onChange={(event) => setAuthType(event.target.value as typeof authType)}
                      >
                        <NativeSelectOption value="none">
                          <Trans>No authentication</Trans>
                        </NativeSelectOption>
                        <NativeSelectOption value="bearer">
                          <Trans>Bearer token</Trans>
                        </NativeSelectOption>
                        <NativeSelectOption value="header">
                          <Trans>API key header</Trans>
                        </NativeSelectOption>
                      </NativeSelect>
                      {authType === "header" ? (
                        <Input
                          value={authName}
                          onChange={(event) => setAuthName(event.target.value)}
                          placeholder={t`Header name`}
                        />
                      ) : null}
                      {authType !== "none" ? (
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={credential}
                          onChange={(event) => setCredential(event.target.value)}
                          placeholder={t`Credential`}
                        />
                      ) : null}
                      <p className="text-xs leading-5 text-muted-foreground">
                        <Trans>Credentials are encrypted and never sent to the model.</Trans>
                      </p>
                      {sourceHint ? (
                        <p className="text-xs leading-5 text-muted-foreground">{sourceHint}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-full"
                          size="sm"
                          disabled={pending === "install-source"}
                          onClick={() => void installSource()}
                        >
                          {pending === "install-source" ? (
                            <Trans>Verifying…</Trans>
                          ) : (
                            <Trans>Verify and add</Trans>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-full"
                          size="sm"
                          onClick={() => setSourceKind(null)}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <div>
                  <div className="mb-3 text-sm font-medium text-foreground/75">
                    <Trans>Tool sources</Trans>
                  </div>
                  {sources.length === 0 && !sourceKind ? (
                    <p className="text-muted-foreground/80">
                      <Trans>No MCP or API tool sources installed yet.</Trans>
                    </p>
                  ) : null}
                  {sources.map((source) => (
                    <div key={source.id} className="flex items-start gap-4 rounded-xl px-3 py-2.5">
                      <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-accent font-semibold uppercase text-foreground">
                        {source.kind === "mcp" ? "M" : source.kind === "graphql" ? "G" : "A"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15.5px] font-medium text-foreground">
                          {source.name}
                        </div>
                        <div className="truncate text-[13.5px] text-muted-foreground/70">
                          {source.kind.toUpperCase()} · {source.source} ·{" "}
                          {source.secretConfigured ? (
                            <Trans>credential saved</Trans>
                          ) : (
                            <Trans>no auth</Trans>
                          )}
                        </div>
                        <PluginStatus
                          status={source.check.status}
                          message={source.check.message}
                          checkedAt={source.check.checkedAt}
                        />
                        {bots.length > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">
                              <Trans>Agents:</Trans>
                            </span>
                            {bots.map((bot) => {
                              const allowed =
                                source.agentIds === null || source.agentIds.includes(bot.id);
                              return (
                                <Button
                                  key={bot.id}
                                  type="button"
                                  variant={allowed ? "default" : "outline"}
                                  size="xs"
                                  className="rounded-full"
                                  aria-pressed={allowed}
                                  onClick={() => void toggleSourceAgent(source, bot.id)}
                                >
                                  {allowed ? <Check aria-hidden="true" /> : null}
                                  {bot.name}
                                </Button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-full"
                        size="sm"
                        disabled={pending === `check:${source.id}`}
                        onClick={() => void checkSource(source)}
                      >
                        {pending === `check:${source.id}` ? (
                          <Trans>Checking…</Trans>
                        ) : (
                          <Trans>Check again</Trans>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-full"
                        size="sm"
                        disabled={pending === source.id}
                        onClick={() => void removeSource(source)}
                      >
                        {pending === source.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
