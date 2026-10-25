import type { LessonDraft, LessonPreview } from "@engaz/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { rpc } from "../../lib/rpc";
import { AgentSkills } from "./AgentSkills";

export function SaveLesson({
  runId,
  onClose,
  onSaved,
}: {
  runId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [preview, setPreview] = useState<LessonPreview | null>(null);
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [corrections, setCorrections] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void rpc.agentSkills
      .previewLesson({ runId })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : t`Could not load`);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runId, t]);

  async function generate() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDraft(
        await rpc.agentSkills.proposeLesson({ runId, reviewKey: preview.reviewKey, corrections }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not draft a lesson. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Save a lesson</Trans>
          </DialogTitle>
          <DialogDescription>
            {draft ? (
              <Trans>Review the new skill before giving it to this agent.</Trans>
            ) : preview ? (
              <Trans>
                Generate a draft with {preview.modelLabel} using this source and your corrections.
              </Trans>
            ) : (
              <Trans>Loading…</Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {preview ? (
          <details className="text-sm">
            <summary className="cursor-pointer">
              <Trans>Source evidence</Trans>
            </summary>
            {preview.truncated ? (
              <p className="mt-2 text-muted-foreground">
                <Trans>Showing part of this run.</Trans>
              </p>
            ) : null}
            <div className="mt-2 max-h-56 space-y-3 overflow-y-auto rounded-md border border-border p-3">
              {preview.evidence.map((entry) => (
                <div key={entry.messageId}>
                  <span className="text-xs text-muted-foreground">{entry.role}</span>
                  <p className="whitespace-pre-wrap break-words" dir="auto">
                    {entry.text}
                  </p>
                </div>
              ))}
              {draft && corrections.trim() ? (
                <p className="whitespace-pre-wrap break-words" dir="auto">
                  {corrections}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
        {draft ? (
          <AgentSkills
            botId={draft.botId}
            lesson={draft}
            onLessonClose={onClose}
            onLessonSaved={onSaved}
            onSkillsChange={() => undefined}
          />
        ) : (
          <>
            {preview ? (
              <>
                <label htmlFor={id} className="text-sm text-muted-foreground">
                  <Trans>Corrections (optional)</Trans>
                </label>
                <Textarea
                  id={id}
                  value={corrections}
                  maxLength={4_000}
                  disabled={busy}
                  onChange={(event) => setCorrections(event.target.value)}
                  rows={3}
                />
                <Button disabled={busy} onClick={() => void generate()}>
                  {busy ? <Trans>Drafting…</Trans> : <Trans>Generate draft</Trans>}
                </Button>
              </>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
