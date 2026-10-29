import type { RunErrorKind } from "@engaz/core";
import { classifyRunError } from "@engaz/core";
import { Button } from "@engaz/ui-web";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import type { Ref } from "react";

export function RunErrorNotice({
  error,
  onChooseModel,
  onOpenModels,
  onDismiss,
  ref,
}: {
  error: string;
  onChooseModel: () => void;
  onOpenModels: () => void;
  onDismiss: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useLingui();
  const { kind, recovery } = classifyRunError(error);
  const summaries: Record<RunErrorKind, string> = {
    "missing-model": t`Connect a model to continue.`,
    authentication: t`The model connection was rejected.`,
    model: t`This model cannot run this request.`,
    usage: t`The model connection has reached its usage limit.`,
    temporary: t`The service is unavailable. Try again.`,
    unknown: t`The run could not finish.`,
  };
  const action = recovery === "choose-model" ? onChooseModel : onOpenModels;
  const actionLabel =
    recovery === "choose-model"
      ? t`Choose a model`
      : recovery === "replace-key"
        ? t`Replace key`
        : t`Connect a model`;
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="composer-error"
      className="mb-3 rounded-[14px] border border-destructive/40 bg-destructive/10 px-4 py-2 text-[13px] text-destructive"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{summaries[kind]}</span>
        {recovery ? (
          <Button variant="ghost" size="sm" data-testid="run-error-recovery" onClick={action}>
            {actionLabel}
          </Button>
        ) : null}
        <button
          type="button"
          aria-label={t`Dismiss error`}
          data-testid="composer-error-dismiss"
          onClick={onDismiss}
          className="shrink-0 text-destructive hover:text-foreground"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
      <details className="mt-1 min-w-0 text-muted-foreground">
        <summary className="cursor-pointer">{t`Details`}</summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{error}</p>
      </details>
    </div>
  );
}
