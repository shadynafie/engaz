import { RealtimeVoice } from "@engaz/adapters/browser/realtime-voice";
import type { ThreadMessage, ThreadSnapshot, VoiceCallRecordInput } from "@engaz/contracts";
import {
  appendVoiceCallLine,
  isSecretAskBlock,
  speechFromBlocks,
  spokenDecision,
  voiceCallMarkdown,
} from "@engaz/core";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { downloadArtifactBytes } from "../lib/artifact-open";
import { dictation } from "../lib/dictation";
import { rpc } from "../lib/rpc";
import { speaker } from "../lib/tts";

type Phase = "listening" | "thinking" | "speaking";

export function CallView({
  botId,
  botName,
  transcribe,
  snapshot,
  onSend,
  onFollowUp,
  onAnswer,
  onClose,
}: {
  botId: string;
  botName: string;
  transcribe: boolean;
  snapshot: ThreadSnapshot | null;
  onSend: (text: string) => Promise<boolean>;
  onFollowUp: (text: string) => Promise<void>;
  onAnswer: (message: ThreadMessage, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [phase, setPhase] = useState<Phase>("listening");
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<Phase>("listening");
  const spokenMessage = useRef<string | null>(null);
  const initialMessages = useRef(new Set(snapshot?.messages.map((message) => message.id)));
  const record = useRef<VoiceCallRecordInput>({
    botId,
    callId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    transcript: [],
  });
  const [saving, setSaving] = useState(false);
  const recordSaved = useRef(false);
  const savePending = useRef(false);
  const endedAt = useRef<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const realtime = useRef<RealtimeVoice | null>(null);
  const liveRef = useRef(false);
  const secretPending = useRef(false);
  const closing = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const askPromptRef = useRef(t`Say yes or no, or answer in a sentence.`);
  askPromptRef.current = t`Say yes or no, or answer in a sentence.`;
  const secretPromptRef = useRef(t`Hang up first, then enter the code on screen.`);
  secretPromptRef.current = t`Hang up first, then enter the code on screen.`;

  function setCallPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  async function hangUp() {
    if (closing.current) return;
    closing.current = true;
    dictation.stop("cancel");
    speaker.stop();
    realtime.current?.close();
    realtime.current = null;
    liveRef.current = false;
    setLive(false);
    endedAt.current ??= new Date().toISOString();
    record.current.endedAt = endedAt.current;
    if (!record.current.transcript.length) {
      onClose();
      return;
    }
    setSaving(true);
    savePending.current = true;
    setSaveFailed(false);
    try {
      await rpc.voice.saveCall(record.current);
      recordSaved.current = true;
      onClose();
    } catch {
      setError(t`Could not save the call. Retry or download the transcript.`);
      setSaveFailed(true);
    } finally {
      setSaving(false);
      savePending.current = false;
      closing.current = false;
    }
  }

  async function startLive() {
    if (connecting || closing.current || pendingSecretAsk(snapshotRef.current)) return;
    setConnecting(true);
    connectingRef.current = true;
    setError(null);
    dictation.stop("cancel");
    speaker.stop();
    const transport = new RealtimeVoice();
    realtime.current = transport;
    try {
      await transport.start((signal) => rpc.voice.realtimeSession({ botId }, { signal }), {
        muted: () => Boolean(pendingSecretAsk(snapshotRef.current)),
        onTranscript: (text) => void handleTranscript(text),
        onSpeaking: (speaking) => setCallPhase(speaking ? "speaking" : "listening"),
        onCaption: setCaption,
        onError: (message) => {
          setError(message);
          transport.close();
          if (realtime.current !== transport) return;
          realtime.current = null;
          liveRef.current = false;
          setLive(false);
          setConnecting(false);
          connectingRef.current = false;
          // Resume the existing provider-neutral call after a broken live connection.
          void listenRef.current();
        },
      });
      if (closing.current || realtime.current !== transport) {
        transport.close();
        return;
      }
      liveRef.current = true;
      setLive(true);
      setCallPhase("listening");
      transport.setMuted(Boolean(pendingSecretAsk(snapshotRef.current)));
    } catch (err) {
      setConnecting(false);
      connectingRef.current = false;
      setError(err instanceof Error ? err.message : t`Could not start live voice`);
      realtime.current = null;
      void listen();
    } finally {
      setConnecting(false);
      connectingRef.current = false;
    }
  }

  function interrupt() {
    if (liveRef.current) {
      realtime.current?.interrupt();
      return;
    }
    if (phaseRef.current === "speaking") speaker.stop();
    else dictation.stop("cancel");
    void listen();
  }

  async function listen() {
    if (closing.current || liveRef.current || connectingRef.current) return;
    if (pendingSecretAsk(snapshotRef.current)) {
      dictation.stop("cancel");
      setCallPhase("listening");
      setHeard("");
      return;
    }
    setCallPhase("listening");
    speaker.stop();
    setHeard("");
    try {
      await dictation.listen({
        mode: "endpoint",
        transcribe,
        onFinal: (text) => void handleTranscript(text),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Microphone failed`);
    }
  }

  const listenRef = useRef(listen);
  listenRef.current = listen;

  async function handleTranscript(text: string) {
    if (closing.current || !text.trim()) {
      void listen();
      return;
    }
    dictation.stop("submit");
    const current = snapshotRef.current;
    if (pendingSecretAsk(current)) {
      setHeard("");
      setCaption("");
      setError(t`Hang up, then enter the code on screen.`);
      return;
    }
    appendVoiceCallLine(record.current, "user", text);
    setHeard(text);
    setCallPhase("thinking");
    const askId = latestAskId(current);
    const askMessage = current?.messages.find((message) => message.id === askId);
    try {
      if (askMessage) {
        const decision = spokenDecision(text);
        await onAnswer(askMessage, decision ?? text);
      } else if (current?.run && ["running", "queued", "leased"].includes(current.run.status)) {
        await onFollowUp(text);
      } else {
        if (!(await onSend(text))) void listen();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not send that`);
      void listen();
    }
  }

  useEffect(() => {
    closing.current = false;
    spokenMessage.current = null;
    void rpc.voice
      .realtimeOptions()
      .then((options) => {
        if (!closing.current)
          setLiveAvailable(options.available && typeof RTCPeerConnection !== "undefined");
      })
      .catch(() => undefined);
    const unsubSpeech = speaker.subscribe((state) => {
      if (liveRef.current) return;
      if (state.status === "speaking") {
        setCallPhase("speaking");
        setCaption(state.caption ?? "");
      } else if (state.status === "idle" && phaseRef.current !== "listening") {
        setCaption("");
        void listen();
      }
      if (state.error) setError(state.error);
    });
    const unsubDictation = dictation.subscribe((state) => {
      if (state.status === "listening") {
        setHeard(pendingSecretAsk(snapshotRef.current) ? "" : state.transcript);
      }
      if (state.error) setError(state.error);
    });
    void listen();
    return () => {
      closing.current = true;
      unsubSpeech();
      unsubDictation();
      dictation.stop("cancel");
      speaker.stop();
      realtime.current?.close();
      // A route change still keeps the call transcript; explicit hangup offers retry on failure.
      if (record.current.transcript.length && !savePending.current && !recordSaved.current) {
        record.current.endedAt = new Date().toISOString();
        void rpc.voice.saveCall(record.current).catch(() => {
          downloadArtifactBytes(
            "voice-call.md",
            "text/markdown",
            new TextEncoder().encode(voiceCallMarkdown(record.current, botName)),
          );
        });
      }
    };
  }, [botId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        hangUp();
      }
      if (event.key === " " && phaseRef.current !== "listening") {
        event.preventDefault();
        interrupt();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (closing.current || saving || saveFailed || connecting) return;
    const messages = snapshot?.messages ?? [];
    const runActive =
      snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status);
    if (runActive) return;
    const lastBot = [...messages].reverse().find((message) => message.role === "bot");
    if (!lastBot || lastBot.id === spokenMessage.current) return;
    const ask = lastBot.blocks.find((block) => block.kind === "ask" && block.status !== "answered");
    if (initialMessages.current.has(lastBot.id) && !ask) return;
    const text = speechFromBlocks(lastBot.blocks);
    if (!text) return;
    spokenMessage.current = lastBot.id;
    const secretAsk = ask && isSecretAskBlock(ask);
    const spoken = secretAsk
      ? `${text}. ${secretPromptRef.current}`
      : ask
        ? `${text}. ${askPromptRef.current}`
        : text;
    if (!secretAsk) appendVoiceCallLine(record.current, "assistant", spoken);
    if (liveRef.current) realtime.current?.speak(spoken);
    else {
      dictation.stop("cancel");
      void speaker.speak(spoken, { botId, messageId: lastBot.id });
    }
  }, [snapshot, botId, connecting, saving, saveFailed]);

  useEffect(() => {
    const secret = Boolean(pendingSecretAsk(snapshot));
    realtime.current?.setMuted(secret);
    const resumed = secretPending.current && !secret;
    secretPending.current = secret;
    if (!secret) {
      if (resumed) void listenRef.current();
      return;
    }
    dictation.stop("cancel");
    setHeard("");
  }, [snapshot]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) hangUp();
      }}
    >
      <DialogContent
        data-testid="call-view"
        showCloseButton={false}
        className="max-w-[420px] rounded-3xl p-6 text-center sm:max-w-[420px]"
      >
        <DialogHeader className="items-center gap-2">
          {liveAvailable && !live && !saveFailed ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={connecting || saving || Boolean(pendingSecretAsk(snapshot))}
              onClick={() => void startLive()}
            >
              {connecting ? <Trans>Connecting…</Trans> : <Trans>Live voice</Trans>}
            </Button>
          ) : null}
          <div className="text-[13px] uppercase tracking-[0.12em] text-muted-foreground/80">
            <Trans>Call</Trans>
          </div>
          <DialogTitle className="text-[22px]">{botName}</DialogTitle>
        </DialogHeader>
        <div className="mt-1 text-[15px] text-foreground/75">
          {phase === "listening" ? (
            <Trans>Listening…</Trans>
          ) : phase === "speaking" ? (
            <Trans>Speaking…</Trans>
          ) : (
            <Trans>Working…</Trans>
          )}
        </div>
        <p className="min-h-[3.2em] text-[14.5px] leading-[1.5] text-muted-foreground">
          {phase === "listening" ? heard || t`Say something. Silence sends it.` : caption}
        </p>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        <div className="mt-2 flex justify-center gap-3">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={saving || saveFailed || connecting}
            onClick={interrupt}
          >
            <Trans>Interrupt</Trans>
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={saving || connecting}
            onClick={() => void hangUp()}
          >
            {saving ? (
              <Trans>Saving…</Trans>
            ) : saveFailed ? (
              <Trans>Retry save</Trans>
            ) : (
              <Trans>Hang up</Trans>
            )}
          </Button>
          {saveFailed ? (
            <Button
              variant="outline"
              onClick={() => {
                downloadArtifactBytes(
                  "voice-call.md",
                  "text/markdown",
                  new TextEncoder().encode(voiceCallMarkdown(record.current, botName)),
                );
                record.current.transcript = [];
                onClose();
              }}
            >
              <Trans>Download and close</Trans>
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground/80">
          <Trans>Space interrupts · Esc hangs up</Trans>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function pendingSecretAsk(snapshot: ThreadSnapshot | null) {
  const askId = latestAskId(snapshot);
  const askMessage = snapshot?.messages.find((message) => message.id === askId);
  return askMessage?.blocks.some(
    (block) => block.kind === "ask" && isSecretAskBlock(block) && block.status !== "answered",
  );
}

function latestAskId(snapshot: ThreadSnapshot | null): string | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      return message.id;
    }
  }
  return null;
}
