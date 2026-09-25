import type { MemoryDocument } from "@engaz/contracts";
import { Button, Skeleton, Textarea } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { downloadArtifactBytes } from "../lib/artifact-open";
import { rpc } from "../lib/rpc";

const fieldClass = "mt-2 w-full font-mono text-[13px] leading-relaxed";

function rowClass(open: boolean): string {
  return `h-auto w-full justify-start whitespace-normal px-2.5 py-2.5 text-start ${open ? "bg-muted" : ""}`;
}

/**
 * This bot's memory documents.
 * User-scoped memory shared across bots lives in the Memory settings overlay.
 */
export function KnowledgeSection({ botId }: { botId: string }) {
  return (
    <section className="mt-6" data-testid="bot-knowledge">
      <div className="mb-2 text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground">
        <Trans>Memory</Trans>
      </div>
      <MemoryDocumentList
        key={botId}
        load={() => rpc.memory.list({ botId, scope: "bot" })}
        exportFilename="memory.md"
        testId="bot-knowledge-memory"
      />
    </section>
  );
}

/** The space's shared memory documents, mounted in the Memory settings overlay. */
export function SpaceMemorySection() {
  return (
    <div className="mt-6" data-testid="space-memory-documents">
      <div className="mb-2 text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground">
        <Trans>Shared documents</Trans>
      </div>
      <MemoryDocumentList
        load={() => rpc.memory.list({ scope: "user" })}
        exportFilename="space-memory.md"
        testId="space-memory-list"
      />
    </div>
  );
}

function MemoryDocumentList({
  load,
  exportFilename,
  testId,
}: {
  load: () => Promise<MemoryDocument[]>;
  exportFilename: string;
  testId: string;
}) {
  const { t } = useLingui();
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<MemoryDocument[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const current = ++generation.current;
    void loadRef
      .current()
      .then((list) => {
        if (current !== generation.current) return;
        setDocs(list);
        setLoading(false);
      })
      .catch(() => {
        if (current !== generation.current) return;
        setDocs([]);
        setLoading(false);
        setError(t`Could not load`);
      });
    return () => {
      generation.current += 1;
    };
  }, [t]);

  function openDoc(doc: MemoryDocument) {
    setOpenId(doc.id);
    setDraft(doc.content);
    setError(null);
  }

  async function save(doc: MemoryDocument) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.memory.update({ documentId: doc.id, content: draft });
      setDocs((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setOpenId(null);
    } catch {
      setError(t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Re-fetch through the section's own loader so the file is current,
      // then sync the list so the export matches what is displayed.
      const fresh = await loadRef.current();
      generation.current += 1;
      setDocs(fresh);
      const markdown = fresh.map((doc) => `# ${doc.path}\n\n${doc.content}`).join("\n\n");
      downloadArtifactBytes(exportFilename, "text/markdown", new TextEncoder().encode(markdown));
    } catch {
      setError(t`Could not load`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={testId}>
      {error ? <div className="px-2.5 pb-2 text-[13px] text-destructive">{error}</div> : null}
      {loading ? <Skeleton className="h-10 w-full" /> : null}
      {!loading && docs.length === 0 && !error ? (
        <div className="px-2.5 py-1 text-[13.5px] text-muted-foreground">
          <Trans>Nothing remembered yet</Trans>
        </div>
      ) : null}
      {docs.map((doc) => (
        <div key={doc.id}>
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => (openId === doc.id ? setOpenId(null) : openDoc(doc))}
            className={rowClass(openId === doc.id)}
          >
            <span className="flex w-full items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] text-foreground" dir="auto">
                {doc.path}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                <Trans>rev {doc.revision}</Trans>
              </span>
            </span>
          </Button>
          {openId === doc.id ? (
            <div className="px-2.5 pb-2">
              <Textarea
                aria-label={doc.path}
                disabled={busy}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
                className={fieldClass}
                dir="auto"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy || draft === doc.content}
                  onClick={() => void save(doc)}
                  className="rounded-lg bg-muted px-3 py-1.5 text-[13px] text-foreground disabled:opacity-50"
                >
                  <Trans>Save</Trans>
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setOpenId(null)}
                  className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground"
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {docs.length ? (
        <Button
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => void exportMarkdown()}
          className="mt-2 px-2.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <Trans>Download as markdown</Trans>
        </Button>
      ) : null}
    </div>
  );
}
