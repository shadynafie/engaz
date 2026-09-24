import type { SignupInvite } from "@engaz/contracts";
import { Button, Input } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

/** Owner-only: one-person sign-up links for new accounts. */
export function InvitesSettingsPanel() {
  const { t } = useLingui();
  const [invites, setInvites] = useState<SignupInvite[]>([]);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc.invites
      .list()
      .then(setInvites)
      .catch(() => setError(t`Could not load invitations`));
  }, [t]);

  async function createInvite() {
    setPending(true);
    setError(null);
    try {
      const result = await rpc.invites.create();
      setCreated({ id: result.invite.id, url: result.url });
      setCopied(false);
      setInvites((current) => [result.invite, ...current]);
    } catch {
      setError(t`Could not create an invitation`);
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    try {
      await rpc.invites.revoke({ id });
      setInvites((current) => current.filter((invite) => invite.id !== id));
      if (created?.id === id) setCreated(null);
    } catch {
      setError(t`Could not revoke the invitation`);
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div data-testid="invites-settings" className="space-y-5">
      <div className="rounded-xl border border-border px-4 py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Invite people</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Each link lets one person create an account. Links expire after 7 days.</Trans>
        </p>
        {created ? (
          <div className="mt-3 flex gap-2">
            <Input readOnly value={created.url} aria-label={t`Invitation link`} />
            <Button
              variant="outline"
              onClick={() => void copy(created.url)}
              aria-label={t`Copy invitation link`}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : null}
        <Button className="mt-3" onClick={() => void createInvite()} disabled={pending}>
          <Trans>Create invitation link</Trans>
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {invites.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {invites.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13px] text-foreground">
                {invite.usedByEmail ? (
                  <Trans>Used by {invite.usedByEmail}</Trans>
                ) : (
                  <Trans>Unused · expires {new Date(invite.expiresAt).toLocaleDateString()}</Trans>
                )}
              </span>
              {invite.usedAt ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void revoke(invite.id)}
                  aria-label={t`Revoke invitation`}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
