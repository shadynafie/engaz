import type { Bot, BotMcpServer, McpServer } from "@engaz/contracts";
import { deriveMcpSlug } from "@engaz/core";
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
} from "@engaz/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PluginStatus } from "../components/PluginStatus";
import { connectMcpOauth, MCP_OAUTH_CHANNEL } from "../lib/mcp-connect";
import { suggestedServerName } from "../lib/mcp-server-name";
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
}: {
  server: McpServer;
  entry: BotMcpServer;
  onToggle: (tool: string) => void;
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

  async function checkServer(serverId: string) {
    setError(null);
    setChecking(serverId);
    try {
      const checked = await rpc.mcp.servers.check({ id: serverId });
      setServers((list) => list.map((server) => (server.id === serverId ? checked : server)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not check this server`);
    } finally {
      setChecking(null);
    }
  }

  async function toggleAssignment(server: McpServer, botId: string) {
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
    }
  }

  /** Lets one agent use, or stop using, one of the server's tools. */
  async function toggleTool(server: McpServer, botId: string, tool: string) {
    setError(null);
    const current = botAssignments[botId] ?? [];
    const entry = current.find((item) => item.serverId === server.id);
    if (!entry) return;
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
                            onClick={() => setExpanded(open ? null : server.id)}
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
                              disabled={oauthPending === server.id}
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
                                        onCheckedChange={() =>
                                          void toggleAssignment(server, bot.id)
                                        }
                                      />
                                    </div>
                                    {entry && server.check.tools.length > 0 ? (
                                      <ToolChoices
                                        server={server}
                                        entry={entry}
                                        onToggle={(tool) => void toggleTool(server, bot.id, tool)}
                                      />
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {needsSignIn ? null : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={checking === server.id}
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
                                disabled={oauthPending === server.id}
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
