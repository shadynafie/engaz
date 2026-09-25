import type { IntegrationSetupState } from "@engaz/contracts";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";
import { rpc } from "../lib/rpc";

export function IntegrationSetupPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const [setupState, setSetupState] = useState<IntegrationSetupState | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([rpc.bots.list(), rpc.integrationSetup.get()])
      .then(([rows, setup]) => {
        if (cancelled) return;
        if (!setup.canConfigure) {
          navigate("/app", { replace: true });
          return;
        }
        if (!rows.length) {
          navigate("/onboarding", { replace: true });
          return;
        }
        setSetupState(setup);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <div className="min-h-full bg-background px-6 py-12">
      <div className="mx-auto max-w-[560px]">
        {setupState ? (
          <IntegrationSetup initialState={setupState} onDone={() => navigate("/app")} />
        ) : (
          <p>{error ? t`Could not load bots. Reload to try again.` : t`Loading…`}</p>
        )}
      </div>
    </div>
  );
}
