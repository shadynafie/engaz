import type { Bot, BotMcpServer, McpServer, McpServerConfigInput } from "@engaz/contracts";
import { deriveMcpSlug, suggestedServerName } from "@engaz/core";
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Switch,
  Textarea,
} from "@engaz/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PluginStatus } from "../components/PluginStatus";
import { connectMcpOauth, MCP_OAUTH_CHANNEL } from "../lib/mcp-connect";
import { rpc } from "../lib/rpc";
import type { McpServerDraft } from "./PluginsOverlay";

/** Whether agents can use the server right now, from its last connection check. */
function McpServerStatus({ server }: { server: McpServer }) {
  const { status, message, tools, checkedAt } = server.check;
  return (
    <PluginStatus
      status={status}
      message={message}
      checkedAt={checkedAt}
      working={<Plural value={tools.length} one="Working · # tool" other="Working · # tools" />}
    />
  );
}

/** The tools one agent may use from a server, described in the server's own words. */
function ToolChoices({
  server,
  entry,
  onToggle,
  disabled,
}: {
  server: McpServer;
  entry: BotMcpServer;
  onToggle: (tool: string) => void;
  disabled: boolean;
}) {
  const descriptions = server.check.toolDescriptions ?? {};
  return (
    <ul className="mt-2 space-y-2 border-l border-border pl-4">
      {server.check.tools.map((tool) => {
        const description = descriptions[tool];
        return (
          <li key={tool} className="flex items-start gap-2.5">
            <Checkbox
              className="mt-0.5"
              aria-label={tool}
              disabled={disabled}
              checked={entry.allowAllTools || entry.allowedTools.includes(tool)}
              onCheckedChange={() => onToggle(tool)}
            />
            <div className="min-w-0 text-[13px] leading-snug">
              <p className="text-foreground">{description ?? tool}</p>
              {description ? (
                <p className="font-mono text-[11px] text-muted-foreground">{tool}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function McpServersOverlay({
  stdioEnabled,
  draft,
  onClose,
}: {
  /** Local commands run inside the Engaz server, so they appear only when the owner enabled them. */
  stdioEnabled: boolean;
  /** Pre-fills the add form, e.g. from a preset or a catalog result. */
  draft?: McpServerDraft;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(Boolean(draft));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [botAssignments, setBotAssignments] = useState<Record<string, BotMcpServer[]>>({});
  const assignmentUpdates = useRef(new Set<string>());
  const discoveryUpdate = useRef(false);
  const [updatingAgents, setUpdatingAgents] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [localCommand, setLocalCommand] = useState(false);
  const [name, setName] = useState(draft?.name ?? "");
  const [endpoint, setEndpoint] = useState(draft?.endpoint ?? "");
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editHeaders, setEditHeaders] = useState("");
  const [editToken, setEditToken] = useState("");
  const [newToken, setNewToken] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [found, setFound] = useState<{ name: string; endpoint: string; host: string }[] | null>(
    null,
  );
  const [finding, setFinding] = useState(false);
  // The sign-in window reports back on a channel; this is the server it was for.
  const oauthPendingRef = useRef<string | null>(null);
  oauthPendingRef.current = oauthPending;

  async function refresh() {
    const [nextServers, nextBots, assignments] = await Promise.all([
      rpc.mcp.servers.list(),
      rpc.bots.list(),
      rpc.mcp.assignments.all(),
    ]);
    const activeBots = nextBots.filter((bot) => !bot.archivedAt);
    setServers(nextServers);
    setBots(activeBots);
    setBotAssignments(
      Object.fromEntries(
        activeBots.map((bot) => [
          bot.id,
          assignments.filter((assignment) => assignment.botId === bot.id),
        ]),
      ),
    );
    return { servers: nextServers, bots: activeBots };
  }

  useEffect(() => {
    void refresh()
      .then((next) => {
        // With nothing added yet, the form is the whole point of opening this.
        if (next.servers.length === 0) setAdding(true);
        // A single server has nothing to choose between, so show its details.
        if (next.servers.length === 1) setExpanded(next.servers[0]!.id);
        // One agent is the common case; giving it the server is what the owner means.
        if (next.bots.length === 1) setSelectedBotIds([next.bots[0]!.id]);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t`Could not load MCP servers`);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    // BroadcastChannel instead of window.opener messaging: provider login
    // pages with COOP sever the opener link, but the channel is origin-scoped
    // and unaffected.
    const channel = new BroadcastChannel(MCP_OAUTH_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type !== "mcp-oauth-complete") return;
      const serverId = oauthPendingRef.current;
      setOauthPending(null);
      if (serverId) void checkServer(serverId);
      else void refresh().catch(() => undefined);
    };
    return () => channel.close();
  }, []);

  /** Looks up remote MCP servers in the public integrations catalog. */
  async function findServers() {
    if (!findQuery.trim()) return;
    setError(null);
    setFinding(true);
    try {
      const response = await rpc.capabilities.catalogSearch({
        query: findQuery.trim(),
        usePublicCatalog: true,
      });
      const byEndpoint = new Map<string, { name: string; endpoint: string; host: string }>();
      for (const result of response.results) {
        for (const surface of result.surfaces) {
          if (surface.kind !== "mcp" || !URL.canParse(surface.source ?? "")) continue;
          const url = new URL(surface.source!);
          if (url.protocol !== "https:") continue;
          byEndpoint.set(url.href, { name: result.name, endpoint: url.href, host: url.host });
        }
      }
      setFound([...byEndpoint.values()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not search`);
    } finally {
      setFinding(false);
    }
  }

  function toggleSelectedBot(id: string) {
    setSelectedBotIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function addServer() {
    setError(null);
    const serverName = name.trim() || suggestedServerName(endpoint);
    if (localCommand ? !command.trim() : !endpoint.trim()) {
      setError(localCommand ? t`Add a command.` : t`Add the server address.`);
      return;
    }
    if (!serverName) {
      setError(t`Add a name.`);
      return;
    }
    setSaving(true);
    try {
      const slug = deriveMcpSlug(serverName);
      const headers = headerValue.trim()
        ? { [headerName.trim() || "Authorization"]: headerValue.trim() }
        : {};
      // The API tries the older SSE connection itself when this one gets no answer.
      const created = localCommand
        ? await rpc.mcp.servers.create({
            slug,
            name: serverName,
            transport: "stdio",
            command: command.trim(),
            args: args.split(/\s+/).filter(Boolean),
            env: {},
            secret: secret || undefined,
            enabled: true,
          })
        : await rpc.mcp.servers.create({
            slug,
            name: serverName,
            transport: "streamable_http",
            endpoint: endpoint.trim(),
            headers,
            secret: secret || undefined,
            enabled: true,
          });
      // The API grants the tools the server offers now; they can be narrowed per agent.
      await Promise.all(
        selectedBotIds.map((botId) => rpc.mcp.assignments.approve({ botId, serverId: created.id })),
      );
      await refresh();
      setAdding(false);
      setExpanded(created.id);
      setName("");
      setEndpoint("");
      setSecret("");
      setHeaderValue("");
      setCommand("");
      setArgs("");
      setLocalCommand(false);
      if (created.check.status === "sign_in") void connectOAuth(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not add MCP server`);
    } finally {
      setSaving(false);
    }
  }

  async function connectOAuth(server: McpServer) {
    setError(null);
    setOauthPending(server.id);
    try {
      const result = await connectMcpOauth(server.id);
      if (result !== "cancelled") setOauthPending(null);
      if (result === "connected") {
        await checkServer(server.id);
        return;
      }
      await refresh();
      if (result === "already_connected") {
        setError(t`This server is already connected. Disconnect it first to authorize again.`);
        return;
      }
      if (result === "authorization_not_requested") {
        setError(t`This server did not request browser authorization.`);
        return;
      }
      setOauthPending((current) => (current === server.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not start OAuth`);
      setOauthPending(null);
    }
  }

  async function refreshAssignments() {
    const assignments = await rpc.mcp.assignments.all();
    const next: Record<string, BotMcpServer[]> = {};
    for (const assignment of assignments) {
      next[assignment.botId] ??= [];
      next[assignment.botId]!.push(assignment);
    }
    setBotAssignments(next);
  }

  async function checkServer(serverId: string) {
    if (discoveryUpdate.current || assignmentUpdates.current.size > 0) return;
    discoveryUpdate.current = true;
    setError(null);
    setChecking(serverId);
    try {
      const checked = await rpc.mcp.servers.check({ id: serverId });
      setServers((list) => list.map((server) => (server.id === serverId ? checked : server)));
      await refreshAssignments().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not check this server`);
    } finally {
      discoveryUpdate.current = false;
      setChecking(null);
    }
  }

  /** Swaps in a new access token, keeping the server's agents and tool choices. */
  async function replaceToken(server: McpServer) {
    if (discoveryUpdate.current || assignmentUpdates.current.size > 0) return;
    discoveryUpdate.current = true;
    setError(null);
    setChecking(server.id);
    try {
      const updated = await rpc.mcp.servers.update({ id: server.id, secret: newToken.trim() });
      setServers((list) => list.map((item) => (item.id === server.id ? updated : item)));
      setNewToken("");
      await refreshAssignments().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save the access token`);
    } finally {
      discoveryUpdate.current = false;
      setChecking(null);
    }
  }

  function editServer(server: McpServer) {
    setEditing(server.id);
    setEditName(server.name);
    setEditEndpoint(server.endpoint ?? "");
    setEditHeaders("");
    setEditToken("");
    setError(null);
  }

  async function saveServer(server: McpServer) {
    if (
      server.transport === "stdio" ||
      discoveryUpdate.current ||
      assignmentUpdates.current.size > 0
    )
      return;
    discoveryUpdate.current = true;
    setError(null);
    setSaving(true);
    try {
      const headers: unknown = editHeaders.trim() ? JSON.parse(editHeaders) : undefined;
      if (
        headers !== undefined &&
        (!headers ||
          typeof headers !== "object" ||
          Array.isArray(headers) ||
          Object.values(headers).some((value) => typeof value !== "string"))
      )
        throw new Error(t`Headers must be a JSON object of names and values.`);
      const config: McpServerConfigInput = {
        slug: server.slug,
        name: editName.trim(),
        description: server.description,
        transport: server.transport,
        endpoint: editEndpoint.trim(),
        enabled: server.enabled,
        ...(headers !== undefined ? { headers: headers as Record<string, string> } : {}),
        ...(editToken.trim() ? { secret: editToken.trim() } : {}),
      };
      const updated = await rpc.mcp.servers.update({ id: server.id, config });
      setServers((list) => list.map((item) => (item.id === server.id ? updated : item)));
      setEditing(null);
      setEditToken("");
      setEditHeaders("");
      await refreshAssignments().catch(() => undefined);
      if (updated.check.status === "sign_in") void connectOAuth(updated);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? t`Headers must be a JSON object of names and values.`
          : err instanceof Error
            ? err.message
            : t`Could not save MCP server`,
      );
    } finally {
      discoveryUpdate.current = false;
      setSaving(false);
    }
  }

  async function toggleAssignment(server: McpServer, botId: string) {
    if (discoveryUpdate.current || assignmentUpdates.current.has(botId)) return;
    assignmentUpdates.current.add(botId);
    setUpdatingAgents([...assignmentUpdates.current]);
    setError(null);
    const current = botAssignments[botId] ?? [];
    const assigned = current.some((entry) => entry.serverId === server.id);
    try {
      if (assigned) {
        await replaceAssignments(
          botId,
          current.filter((entry) => entry.serverId !== server.id),
        );
      } else {
        const added = await rpc.mcp.assignments.approve({ botId, serverId: server.id });
        setBotAssignments((map) => ({ ...map, [botId]: [...current, added] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not update agent access`);
    } finally {
      assignmentUpdates.current.delete(botId);
      setUpdatingAgents([...assignmentUpdates.current]);
    }
  }

  /** Lets one agent use, or stop using, one of the server's tools. */
  async function toggleTool(server: McpServer, botId: string, tool: string) {
    setError(null);
    const current = botAssignments[botId] ?? [];
    const entry = current.find((item) => item.serverId === server.id);
    if (!entry || discoveryUpdate.current || assignmentUpdates.current.has(botId)) return;
    assignmentUpdates.current.add(botId);
    setUpdatingAgents([...assignmentUpdates.current]);
    const allowed = entry.allowAllTools ? server.check.tools : entry.allowedTools;
    const nextTools = allowed.includes(tool)
      ? allowed.filter((name) => name !== tool)
      : [...allowed, tool];
    try {
      await replaceAssignments(
        botId,
        current.map((item) =>
          item.serverId === server.id
            ? { ...item, allowAllTools: false, allowedTools: nextTools }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not update agent access`);
    } finally {
      assignmentUpdates.current.delete(botId);
      setUpdatingAgents([...assignmentUpdates.current]);
    }
  }

  async function replaceAssignments(botId: string, next: BotMcpServer[]) {
    const updated = await rpc.mcp.assignments.replace({
      botId,
      assignments: next.map(({ serverId, allowAllTools, allowedTools }) => ({
        serverId,
        allowAllTools,
        allowedTools,
      })),
    });
    setBotAssignments((map) => ({ ...map, [botId]: updated }));
  }

  async function deleteServer(server: McpServer) {
    if (confirmingDelete !== server.id) {
      setConfirmingDelete(server.id);
      return;
    }
    setConfirmingDelete(null);
    setError(null);
    try {
      await rpc.mcp.servers.remove({ id: server.id });
      setExpanded(null);
      const next = await refresh();
      if (next.servers.length === 0) setAdding(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not delete MCP server`);
    }
  }

  async function disconnectOAuth(server: McpServer) {
    setError(null);
    try {
      setOauthPending(server.id);
      await rpc.mcp.oauth.disconnect({ serverId: server.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not disconnect OAuth`);
    } finally {
      setOauthPending(null);
    }
  }

  function assignmentFor(server: McpServer, botId: string) {
    return (botAssignments[botId] ?? []).find((entry) => entry.serverId === server.id);
  }

  const suggestedName = suggestedServerName(endpoint);

  const addForm = (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void addServer();
      }}
    >
      <FieldGroup className="gap-4">
        {localCommand ? (
          <>
            <Field>
              <FieldLabel htmlFor="mcp-command">
                <Trans>Command</Trans>
              </FieldLabel>
              <Input
                id="mcp-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/opt/mcp-server"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-args">
                <Trans>Arguments</Trans>
              </FieldLabel>
              <Input
                id="mcp-args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--stdio"
              />
            </Field>
          </>
        ) : (
          <>
            {draft ? null : (
              <details className="group" open={found !== null}>
                <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <Trans>Find a server</Trans>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform group-open:rotate-90"
                  />
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      aria-label={t`Search apps`}
                      placeholder={t`Search apps`}
                      value={findQuery}
                      onChange={(e) => {
                        setFindQuery(e.target.value);
                        setFound(null);
                      }}
                      onKeyDown={(e) => {
                        // Enter searches here instead of submitting the add form.
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        void findServers();
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={finding || !findQuery.trim()}
                      onClick={() => void findServers()}
                    >
                      {finding ? <Trans>Searching…</Trans> : <Trans>Search</Trans>}
                    </Button>
                  </div>
                  {found?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <Trans>No remote MCP servers found</Trans>
                    </p>
                  ) : null}
                  {found?.map((result) => (
                    <button
                      key={result.endpoint}
                      type="button"
                      aria-pressed={endpoint === result.endpoint}
                      onClick={() => {
                        setEndpoint(result.endpoint);
                        setName(result.name);
                      }}
                      className={`flex w-full min-w-0 items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-accent ${endpoint === result.endpoint ? "bg-muted" : ""}`}
                    >
                      <span className="text-foreground">{result.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{result.host}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
            <Field>
              <FieldLabel htmlFor="mcp-endpoint">
                <Trans>Server address</Trans>
              </FieldLabel>
              <Input
                id="mcp-endpoint"
                value={endpoint}
                autoFocus
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://example.com/mcp"
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="mcp-name">
            <Trans>Name</Trans>
          </FieldLabel>
          <Input
            id="mcp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestedName || t`e.g. Files`}
          />
        </Field>
        {bots.length > 0 ? (
          <fieldset>
            <legend className="text-sm font-medium text-foreground">
              <Trans>Agents that can use it</Trans>
            </legend>
            <div className="mt-2 space-y-2">
              {bots.map((bot) => (
                <div key={bot.id} className="flex items-center gap-2.5 text-sm text-foreground">
                  <Checkbox
                    id={`mcp-agent-${bot.id}`}
                    checked={selectedBotIds.includes(bot.id)}
                    onCheckedChange={() => toggleSelectedBot(bot.id)}
                  />
                  <label htmlFor={`mcp-agent-${bot.id}`}>{bot.name}</label>
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}
        <details className="group" open={draft?.needsToken}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <Trans>Advanced</Trans>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-90"
            />
          </summary>
          <div className="mt-3 space-y-4">
            <Field>
              <FieldLabel htmlFor="mcp-secret">
                <Trans>Access token (optional)</Trans>
              </FieldLabel>
              <Input
                id="mcp-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t`Stored encrypted`}
              />
            </Field>
            {!localCommand ? (
              <div className="grid grid-cols-[.7fr_1fr] gap-2">
                <Input
                  aria-label={t`Header name`}
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                />
                <Input
                  aria-label={t`Header value`}
                  type="password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder={t`Optional header value`}
                />
              </div>
            ) : null}
            {stdioEnabled ? (
              <div className="flex items-center justify-between gap-3 text-sm text-foreground">
                <Trans>Run a command on the Engaz server instead</Trans>
                <Switch
                  aria-label={t`Run a command on the Engaz server instead`}
                  checked={localCommand}
                  onCheckedChange={setLocalCommand}
                />
              </div>
            ) : null}
          </div>
        </details>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        {servers.length > 0 ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setAdding(false)}>
            <Trans>Cancel</Trans>
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
        </Button>
      </div>
    </form>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100%-2rem)] w-[600px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[600px]"
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-border px-6 py-5">
          <DialogTitle className="text-xl text-foreground">
            {adding ? <Trans>Add MCP server</Trans> : <Trans>MCP servers</Trans>}
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close MCP servers`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        <div className="rk-scroll min-h-0 overflow-y-auto p-6">
          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          {!loaded ? null : adding ? (
            addForm
          ) : (
            <>
              <ul className="space-y-2">
                {servers.map((server) => {
                  const open = expanded === server.id;
                  const users = bots.filter((bot) => assignmentFor(server, bot.id));
                  const needsSignIn =
                    server.check.status === "sign_in" || server.oauthStatus === "reconnect";
                  return (
                    <li key={server.id} className="rounded-xl border border-border">
                      <div className="relative flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          {/* The name toggles the details; its overlay makes the whole row clickable. */}
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => {
                              setExpanded(open ? null : server.id);
                              setNewToken("");
                              setEditing(null);
                            }}
                            className="text-start text-[15px] font-medium text-foreground after:absolute after:inset-0 after:rounded-xl hover:after:bg-accent/40"
                          >
                            {server.name}
                          </button>
                          <McpServerStatus server={server} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {users.length > 0 ? (
                              <Trans>Used by {users.map((bot) => bot.name).join(", ")}</Trans>
                            ) : (
                              <Trans>No agent uses it yet</Trans>
                            )}
                          </p>
                          {needsSignIn ? (
                            <Button
                              type="button"
                              size="sm"
                              className="relative z-10 mt-3"
                              disabled={
                                oauthPending === server.id ||
                                checking !== null ||
                                saving ||
                                updatingAgents.length > 0
                              }
                              onClick={() => void connectOAuth(server)}
                            >
                              {oauthPending === server.id ? (
                                <Trans>Signing in…</Trans>
                              ) : (
                                <Trans>Sign in</Trans>
                              )}
                            </Button>
                          ) : null}
                        </div>
                        <ChevronRight
                          aria-hidden="true"
                          className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        />
                      </div>
                      {open ? (
                        <div className="space-y-4 border-t border-border px-4 pt-3 pb-4">
                          <p className="truncate text-xs text-muted-foreground">
                            {server.endpoint ?? server.command ?? server.slug}
                          </p>
                          {editing === server.id ? (
                            <form
                              className="space-y-4"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveServer(server);
                              }}
                            >
                              <Field>
                                <FieldLabel htmlFor="mcp-edit-name">
                                  <Trans>Name</Trans>
                                </FieldLabel>
                                <Input
                                  id="mcp-edit-name"
                                  value={editName}
                                  onChange={(event) => setEditName(event.target.value)}
                                  disabled={saving}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="mcp-edit-endpoint">
                                  <Trans>Server address</Trans>
                                </FieldLabel>
                                <Input
                                  id="mcp-edit-endpoint"
                                  value={editEndpoint}
                                  onChange={(event) => setEditEndpoint(event.target.value)}
                                  disabled={saving}
                                />
                              </Field>
                              <details>
                                <summary className="cursor-pointer text-sm text-muted-foreground">
                                  <Trans>Advanced</Trans>
                                </summary>
                                <div className="mt-3 space-y-4">
                                  <Field>
                                    <FieldLabel htmlFor="mcp-edit-token">
                                      <Trans>New access token</Trans>
                                    </FieldLabel>
                                    <Input
                                      id="mcp-edit-token"
                                      type="password"
                                      value={editToken}
                                      onChange={(event) => setEditToken(event.target.value)}
                                      disabled={saving}
                                      placeholder={t`Leave blank to keep saved token`}
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel htmlFor="mcp-edit-headers">
                                      <Trans>Replace headers (JSON)</Trans>
                                    </FieldLabel>
                                    <Textarea
                                      id="mcp-edit-headers"
                                      value={editHeaders}
                                      onChange={(event) => setEditHeaders(event.target.value)}
                                      disabled={saving}
                                      placeholder={t`Leave blank to keep saved headers`}
                                    />
                                    {server.headerKeys.length ? (
                                      <p className="text-xs text-muted-foreground">
                                        {server.headerKeys.join(", ")}
                                      </p>
                                    ) : null}
                                  </Field>
                                </div>
                              </details>
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  disabled={
                                    saving ||
                                    checking !== null ||
                                    updatingAgents.length > 0 ||
                                    !editName.trim() ||
                                    !editEndpoint.trim()
                                  }
                                >
                                  {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={saving}
                                  onClick={() => setEditing(null)}
                                >
                                  <Trans>Cancel</Trans>
                                </Button>
                              </div>
                            </form>
                          ) : server.transport !== "stdio" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => editServer(server)}
                            >
                              <Trans>Edit</Trans>
                            </Button>
                          ) : null}
                          {bots.length > 0 ? (
                            <ul className="space-y-3" aria-label={t`Agents`}>
                              <li aria-hidden="true" className="text-xs text-muted-foreground">
                                <Trans>Agents</Trans>
                              </li>
                              {bots.map((bot) => {
                                const entry = assignmentFor(server, bot.id);
                                return (
                                  <li key={bot.id}>
                                    <div className="flex items-center justify-between gap-3 text-sm text-foreground">
                                      {bot.name}
                                      <Switch
                                        aria-label={bot.name}
                                        checked={Boolean(entry)}
                                        disabled={
                                          checking !== null ||
                                          saving ||
                                          oauthPending !== null ||
                                          updatingAgents.includes(bot.id)
                                        }
                                        onCheckedChange={() =>
                                          void toggleAssignment(server, bot.id)
                                        }
                                      />
                                    </div>
                                    {entry && server.check.tools.length > 0 ? (
                                      <ToolChoices
                                        server={server}
                                        entry={entry}
                                        disabled={
                                          checking !== null ||
                                          saving ||
                                          oauthPending !== null ||
                                          updatingAgents.includes(bot.id)
                                        }
                                        onToggle={(tool) => void toggleTool(server, bot.id, tool)}
                                      />
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                          {editing !== server.id &&
                          server.check.status === "failing" &&
                          server.transport !== "stdio" &&
                          server.oauthStatus === "none" ? (
                            // A rejected token is the usual failure; replacing it keeps everything else.
                            <div className="flex gap-2">
                              <Input
                                type="password"
                                aria-label={t`New access token`}
                                placeholder={t`New access token`}
                                value={newToken}
                                onChange={(e) => setNewToken(e.target.value)}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                disabled={
                                  checking !== null ||
                                  saving ||
                                  updatingAgents.length > 0 ||
                                  !newToken.trim()
                                }
                                onClick={() => void replaceToken(server)}
                              >
                                <Trans>Save</Trans>
                              </Button>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {needsSignIn ? null : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={checking !== null || saving || updatingAgents.length > 0}
                                onClick={() => void checkServer(server.id)}
                              >
                                {checking === server.id ? (
                                  <Trans>Checking…</Trans>
                                ) : (
                                  <Trans>Check again</Trans>
                                )}
                              </Button>
                            )}
                            {server.oauthStatus === "connected" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                  oauthPending === server.id ||
                                  checking !== null ||
                                  saving ||
                                  updatingAgents.length > 0
                                }
                                onClick={() => void disconnectOAuth(server)}
                              >
                                <Trans>Sign out</Trans>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant={confirmingDelete === server.id ? "destructive" : "ghost"}
                              size="sm"
                              className="ml-auto"
                              onClick={() => void deleteServer(server)}
                            >
                              {confirmingDelete === server.id ? (
                                <Trans>Confirm delete</Trans>
                              ) : (
                                <Trans>Delete</Trans>
                              )}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="mt-4 w-full"
                onClick={() => setAdding(true)}
              >
                <Trans>Add server</Trans>
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
