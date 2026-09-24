import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

/** Whether agents can use a plugin right now, from its last check or tool call. */
export function PluginStatus({
  status,
  message,
  checkedAt,
  working,
}: {
  status: "unchecked" | "working" | "sign_in" | "failing";
  message: string | null;
  checkedAt: string | null;
  /** What "working" says, e.g. how many tools the plugin offers. */
  working?: ReactNode;
}) {
  const tone =
    status === "working"
      ? "bg-success"
      : status === "failing"
        ? "bg-destructive"
        : status === "sign_in"
          ? "bg-warning"
          : "bg-muted-foreground/40";
  return (
    <div
      className="mt-2 text-xs"
      title={checkedAt ? t`Checked ${new Date(checkedAt).toLocaleString()}` : undefined}
    >
      <p className="flex items-center gap-1.5 text-foreground">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${tone}`} />
        {status === "working" ? (
          (working ?? <Trans>Working</Trans>)
        ) : status === "sign_in" ? (
          <Trans>Sign in needed</Trans>
        ) : status === "failing" ? (
          <Trans>Needs attention</Trans>
        ) : (
          <Trans>Not checked yet</Trans>
        )}
      </p>
      {status === "failing" && message ? <p className="mt-1 text-destructive">{message}</p> : null}
    </div>
  );
}
