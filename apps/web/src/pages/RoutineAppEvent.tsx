import type { Connection, Routine } from "@engaz/contracts";
import { Button, NativeSelect, NativeSelectOption, Textarea } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";

type EventType = { slug: string; name: string; config: Record<string, unknown> };

export function RoutineAppEvent({
  routine,
  onSaved,
  draft,
}: {
  routine: Routine | null;
  draft: { botId: string; name: string; prompt: string; active: boolean };
  onSaved?: (routine: Routine) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [binding, setBinding] = useState(routine?.appEvent ?? null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [types, setTypes] = useState<EventType[]>([]);
  const [event, setEvent] = useState("");
  const [config, setConfig] = useState("{}");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    rpc.connections
      .list()
      .then((rows) => {
        if (!cancelled)
          setConnections(
            rows.filter((row) => row.connectorId === "composio" && row.status === "connected"),
          );
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not load apps`);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);
  useEffect(() => {
    setTypes([]);
    setEvent("");
    setConfig("{}");
    if (!connectionId) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    rpc.routines
      .eventTypes({ connectionId })
      .then((rows) => {
        if (!cancelled) setTypes(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t`Could not load events`);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, t]);
  async function connect() {
    setError(null);
    setBusy(true);
    let created: Routine | null = null;
    try {
      const parsed: unknown = JSON.parse(config);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(t`Enter event settings as a JSON object`);
      if (!routine)
        created = await rpc.routines.create({
          botId: draft.botId,
          name: draft.name,
          prompt: draft.prompt,
          active: false,
          crons: [],
        });
      const target = routine ?? created!;
      let next = await rpc.routines.connectEvent({
        routineId: target.id,
        connectionId,
        event,
        config: parsed as Record<string, unknown>,
      });
      if (created && draft.active)
        next = await rpc.routines.update({ routineId: next.id, active: true });
      created = null;
      setBinding(next.appEvent);
      onSaved?.(next);
      setOpen(false);
    } catch (err) {
      if (created) await rpc.routines.remove({ routineId: created.id }).catch(() => undefined);
      setError(err instanceof Error ? err.message : t`Could not save event`);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setError(null);
    setBusy(true);
    try {
      if (!routine) return;
      const next = await rpc.routines.disconnectEvent({ routineId: routine.id });
      setBinding(next.appEvent);
      onSaved?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not remove event`);
    } finally {
      setBusy(false);
    }
  }
  const selected = types.find((item) => item.slug === event);
  return (
    <div className="mt-3 space-y-3">
      {binding ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="min-w-0 truncate text-sm">{binding.name}</span>
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => void disconnect()}>
            <Trans>Remove app event</Trans>
          </Button>
        </div>
      ) : null}
      {!open ? (
        !binding ? (
          <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
            <Trans>Connect app event</Trans>
          </Button>
        ) : null
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-3">
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Connect an app in Integrations to choose its events.</Trans>
            </p>
          ) : null}
          <label htmlFor={`${id}-app`} className="block text-sm">
            <Trans>App</Trans>
          </label>
          <NativeSelect
            id={`${id}-app`}
            value={connectionId}
            disabled={busy}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            <NativeSelectOption value="">{t`Choose an app`}</NativeSelectOption>
            {connections.map((connection) => (
              <NativeSelectOption key={connection.id} value={connection.id}>
                {connection.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <label htmlFor={`${id}-event`} className="block text-sm">
            <Trans>Event</Trans>
          </label>
          <NativeSelect
            id={`${id}-event`}
            value={event}
            disabled={busy || !connectionId}
            onChange={(e) => setEvent(e.target.value)}
          >
            <NativeSelectOption value="">{t`Choose an event`}</NativeSelectOption>
            {types.map((item) => (
              <NativeSelectOption key={item.slug} value={item.slug}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {selected && Object.keys(selected.config).length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                <Trans>Event settings</Trans>
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {JSON.stringify(selected.config, null, 2)}
              </pre>
              <Textarea
                aria-label={t`Event settings JSON`}
                className="mt-2 font-mono"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">
            <Trans>Experimental outbound connection. Missed events may need to be replayed.</Trans>
          </p>
          <div className="flex gap-2">
            <Button
              disabled={
                busy || !event || (!routine && (!draft.name.trim() || !draft.prompt.trim()))
              }
              onClick={() => void connect()}
            >
              <Trans>Connect</Trans>
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
