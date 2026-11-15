import type { Artifact } from "@engaz/contracts";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Download, Files, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { downloadArtifact, fetchArtifactBytes } from "../lib/artifact-open";
import { rpc } from "../lib/rpc";

export function FilesButton({
  target,
  compact = false,
}: {
  target: ArtifactTarget;
  compact?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setOpen(true)}
        aria-label={t`Files`}
      >
        <Files size={16} aria-hidden="true" />
        {compact ? null : <Trans>Files</Trans>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <Trans>Files</Trans>
            </DialogTitle>
          </DialogHeader>
          {open ? <FileList key={JSON.stringify(target)} target={target} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FileList({ target }: { target: ArtifactTarget }) {
  const { t } = useLingui();
  const [files, setFiles] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null);
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void rpc.artifacts
      .list(JSON.parse(targetKey) as ArtifactTarget)
      .then((rows) => {
        if (!cancelled) setFiles(rows);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not load files`);
      });
    return () => {
      cancelled = true;
    };
  }, [targetKey, revision, t]);

  async function openFile(file: Artifact, download: boolean) {
    setBusy(file.id);
    setError(null);
    try {
      if (!download && file.mimeType.startsWith("text/") && file.size <= 256 * 1024) {
        const bytes = await fetchArtifactBytes(target, file.id);
        setPreview({ name: file.name, text: new TextDecoder().decode(bytes) });
      } else {
        await downloadArtifact(target, file.id, file.name, file.mimeType);
      }
    } catch {
      setError(t`Could not open file`);
    } finally {
      setBusy(null);
    }
  }

  const visible = files?.filter((file) =>
    file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="min-w-0 space-y-3" data-testid="file-library">
      <div className="flex gap-2">
        <Input
          aria-label={t`Search files`}
          placeholder={t`Search files`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Refresh files`}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {files === null && !error ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : null}
      {visible?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? <Trans>No files match</Trans> : <Trans>No files yet</Trans>}
        </p>
      ) : null}
      {visible?.map((file) => (
        <div key={file.id} className="flex min-w-0 items-center gap-2 border-b border-border py-2">
          <Button
            variant="ghost"
            className="min-w-0 flex-1 justify-start"
            disabled={busy !== null}
            onClick={() => void openFile(file, false)}
          >
            <span className="truncate">{file.name}</span>
          </Button>
          <span className="shrink-0 text-xs text-muted-foreground">
            {Math.max(1, Math.ceil(file.size / 1024))} KB
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy !== null}
            aria-label={t`Download ${file.name}`}
            onClick={() => void openFile(file, true)}
          >
            <Download size={16} />
          </Button>
        </div>
      ))}
      {preview ? (
        <section className="min-w-0 rounded-lg bg-muted p-3" aria-label={preview.name}>
          <div className="mb-2 break-words text-sm font-medium">{preview.name}</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
            {preview.text}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
