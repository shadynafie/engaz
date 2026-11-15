import type { WorkSummary as Summary } from "@engaz/core";
import { Button } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { ActivityDetails } from "../pages/ActivityList";

export function WorkSummary({ summary, runId }: { summary: Summary; runId?: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const { t } = useLingui();
  return (
    <details className="mt-2 text-xs text-muted-foreground" data-testid="work-summary">
      <summary className="w-fit cursor-pointer rounded px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {summary.count === 1 ? t`1 action` : t`${summary.count} actions`}
      </summary>
      <ul className="mt-1 space-y-1 ps-4">
        {summary.steps.map((step) => (
          <li key={step.label}>
            {step.label}
            {step.count > 1 ? ` × ${step.count}` : ""}
          </li>
        ))}
      </ul>
      {runId ? (
        <Button variant="ghost" size="sm" onClick={() => setShowDetails(true)}>
          <Trans>Details</Trans>
        </Button>
      ) : null}
      {showDetails && runId ? (
        <ActivityDetails runId={runId} onClose={() => setShowDetails(false)} />
      ) : null}
    </details>
  );
}
