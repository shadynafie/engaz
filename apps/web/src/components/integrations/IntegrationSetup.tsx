import type { IntegrationSetupState } from "@engaz/contracts";
import { Button, Input } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { rpc } from "../../lib/rpc";

type Choice = "composio" | "pipedream";

/** Connects the managed app catalog; MCP servers are added on their own screen. */
export function IntegrationSetup({
  onDone,
  initialState,
}: {
  onDone?: () => void;
  initialState?: IntegrationSetupState | null;
}) {
  const { t } = useLingui();
  const fieldId = useId();
  const [state, setState] = useState<IntegrationSetupState | null>(initialState ?? null);
  const [choice, setChoice] = useState<Choice>("composio");
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices: { id: Choice; label: string }[] = [
    { id: "composio", label: "Composio" },
    { id: "pipedream", label: "Pipedream" },
  ];
  const hasCredentials = Boolean(apiKey.trim());
  const credentialsReady =
    hasCredentials && (choice !== "pipedream" || Boolean(clientId.trim() && projectId.trim()));
  const configured = state?.providers.find((provider) => provider.id === choice)?.configured;
  useEffect(() => {
    if (initialState) return;
    void rpc.integrationSetup
      .get()
      .then(setState)
      .catch(() => setError(t`Could not load integrations`));
  }, [initialState]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      setBusy(false);
    }
  }

  async function saveProvider() {
    await run(async () => {
      await rpc.integrationSetup.save(
        choice === "composio"
          ? { provider: "composio", apiKey }
          : {
              provider: "pipedream",
              clientId,
              clientSecret: apiKey,
              projectId,
              environment: "production",
            },
      );
      setApiKey("");
      setState(await rpc.integrationSetup.get());
      onDone?.();
    });
  }

  if (!state?.canConfigure) return error ? <p role="alert">{error}</p> : null;

  return (
    <div className="space-y-6">
      <h1 className="text-[32px] font-medium text-foreground">
        <Trans>Server integrations</Trans>
      </h1>
      <fieldset
        aria-label={t`Integration options`}
        className="overflow-hidden rounded-xl border border-border"
      >
        {choices.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={choice === id}
            disabled={busy}
            onClick={() => {
              setChoice(id);
              setApiKey("");
              setError(null);
            }}
            className={`flex min-h-11 w-full items-center justify-between border-b border-border px-3.5 py-2.5 text-left last:border-0 ${choice === id ? "bg-muted" : "hover:bg-accent"}`}
          >
            <span>{label}</span>
            {choice === id ? <Check className="size-4" aria-hidden /> : null}
          </button>
        ))}
      </fieldset>
      {configured ? (
        <p className="text-sm text-success">
          <Trans>Connected</Trans>
        </p>
      ) : null}
      {choice === "pipedream" ? (
        <>
          <label htmlFor={`${fieldId}-client-id`} className="block text-sm">
            <Trans>Client ID</Trans>
            <Input
              id={`${fieldId}-client-id`}
              className="mt-2"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label htmlFor={`${fieldId}-project-id`} className="block text-sm">
            <Trans>Project ID</Trans>
            <Input
              id={`${fieldId}-project-id`}
              className="mt-2"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      ) : null}
      <label htmlFor={`${fieldId}-key`} className="block text-sm">
        {choice === "composio" ? t`API key` : t`Client secret`}
        <Input
          id={`${fieldId}-key`}
          className="mt-2"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="new-password"
        />
      </label>
      <a
        className="text-sm text-muted-foreground underline"
        href={
          choice === "composio"
            ? "https://dashboard.composio.dev"
            : "https://pipedream.com/docs/connect/mcp/developers"
        }
        target="_blank"
        rel="noreferrer"
      >
        <Trans>Get credentials</Trans>
      </a>
      {!onDone ? (
        <Button
          className="ml-3"
          disabled={busy || !credentialsReady}
          onClick={() => void saveProvider()}
        >
          {busy ? t`Connecting…` : t`Connect`}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {onDone ? (
        <div className="flex gap-3">
          <Button
            disabled={busy || (!credentialsReady && (!configured || hasCredentials))}
            onClick={() => {
              if (hasCredentials) void saveProvider();
              else onDone();
            }}
          >
            {busy ? t`Connecting…` : t`Continue`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            <Trans>Skip</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
