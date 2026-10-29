// Inspired by Rakazo's Apache-2.0 chat gallery (PR #2258); uses Engaz's real components.
import type { MessageBlock, ThreadMessage } from "@engaz/contracts";
import { DEFAULT_GROK_BOT_COLOR } from "@engaz/ui-web";
import { I18nProvider } from "@lingui/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ComposerDraft } from "../../src/lib/composer-draft";
import { emptyComposerDraft } from "../../src/lib/composer-draft";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import { Composer, Transcript } from "../../src/pages/Shell";
import "../../src/styles.css";

const BOT = { botId: "gallery-chief", name: "Chief", color: DEFAULT_GROK_BOT_COLOR };
const noop = () => {};
const resolved = async () => {};
let seq = 0;
function message(
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id: `gallery-${seq}`,
    threadId: "gallery",
    seq,
    role,
    blocks,
    botId: role === "bot" ? BOT.botId : undefined,
    createdAt: "2026-10-29T09:00:00Z",
    ...extra,
  };
}
const user = (text: string) => message("user", [{ kind: "text", text }]);
const bot = (...blocks: MessageBlock[]) => message("bot", blocks);
const first = user("Prepare a short launch checklist for our next release.");
const answer = bot({
  kind: "text",
  text: "Here's the plan:\n\n1. Check **web, desktop and mobile**.\n2. Verify backup and restore.\n3. Review the release.\n\nKeep the checklist in `release.md`.",
});
const scenarios = [
  {
    id: "failure",
    label: "Model recovery",
    error: "Your credit balance is too low",
    messages: [first],
  },
  {
    id: "conversation",
    label: "Conversation",
    messages: [
      first,
      answer,
      user("Keep it short."),
      user("Include mobile checks too."),
      bot({ kind: "text", text: "Added. Each platform has its own verification step." }),
    ],
  },
  {
    id: "working",
    label: "Working",
    working: true,
    messages: [first, bot({ kind: "text", text: "I'm reviewing the release checks." })],
  },
  {
    id: "questions",
    label: "Questions",
    messages: [
      first,
      bot({
        kind: "choice",
        question: "Which release channel?",
        options: [
          { id: "stable", letter: "A", label: "Stable" },
          { id: "preview", letter: "B", label: "Preview" },
        ],
        answerId: "stable",
      }),
      bot({ kind: "ask", text: "When should the review begin?", status: "pending" }),
    ],
  },
  {
    id: "approval",
    label: "Approval",
    messages: [
      first,
      bot({
        kind: "ask",
        text: "Publish the release notes?",
        detail: "Publish the reviewed release notes to the project.",
        approvalEffectId: "gallery-approval",
        status: "pending",
        actions: [
          { id: "allow", label: "Allow once" },
          { id: "deny", label: "Deny" },
        ],
      }),
    ],
  },
  {
    id: "secret",
    label: "Secret request",
    messages: [
      user("Connect the demo account."),
      bot({
        kind: "ask",
        text: "Enter the demo account password.",
        input: "secret",
        purpose: "password",
        status: "pending",
      }),
    ],
  },
  {
    id: "delegation",
    label: "Delegation",
    messages: [
      first,
      bot({
        kind: "subagent",
        agentId: "gallery-reviewer",
        name: "Reviewer",
        task: "Review the launch checklist",
        status: "completed",
        result: "The checklist covers all three platforms.",
      }),
      bot({
        kind: "text",
        text: "The review is complete. Two device checks still need your attention.",
      }),
    ],
  },
  {
    id: "cards",
    label: "Cards and tables",
    messages: [
      first,
      bot({
        kind: "card",
        lines: [
          { k: "Release", v: "Preview" },
          { k: "Status", v: "Ready for review" },
        ],
      }),
      bot({
        kind: "text",
        text: "| Platform | Check |\n| --- | --- |\n| Web | Passed |\n| Mobile | Device review |\n\n> Device testing is still pending.",
      }),
    ],
  },
  {
    id: "long",
    label: "Long messages",
    messages: [
      user("Review ".repeat(45)),
      bot({
        kind: "text",
        text: `An agent response with an unusually long identifier:\n\n${"project_".repeat(70)}`,
      }),
      message("user", [{ kind: "text", text: "Check this part." }], {
        replyToMessageId: answer.id,
        replyQuote: "Verify backup and restore.",
      }),
    ],
  },
];

function Gallery() {
  const params = new URLSearchParams(location.search);
  const [scenarioId, setScenarioId] = useState(params.get("scenario") ?? "conversation");
  const [dark, setDark] = useState(params.get("theme") === "dark");
  const [phone, setPhone] = useState(params.get("width") === "phone");
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0]!;
  function update(next: { scenario?: string; dark?: boolean; phone?: boolean }) {
    const id = next.scenario ?? scenarioId;
    const theme = next.dark ?? dark;
    const narrow = next.phone ?? phone;
    setScenarioId(id);
    setDark(theme);
    setPhone(narrow);
    applyResolvedAppearance(theme ? "dark" : "light");
    history.replaceState(
      null,
      "",
      `?${new URLSearchParams({ scenario: id, theme: theme ? "dark" : "light", width: narrow ? "phone" : "desktop" })}`,
    );
  }
  return (
    <div className="flex min-h-dvh flex-col bg-muted text-foreground">
      <header className="flex flex-wrap items-center gap-4 border-b border-border bg-background p-3">
        <label>
          Scenario{" "}
          <select
            aria-label="Scenario"
            value={scenario.id}
            onChange={(event) => update({ scenario: event.target.value })}
            className="rounded-lg border border-border bg-background p-1"
          >
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => update({ dark: event.target.checked })}
          />{" "}
          Dark
        </label>
        <label>
          <input
            type="checkbox"
            checked={phone}
            onChange={(event) => update({ phone: event.target.checked })}
          />{" "}
          Phone width
        </label>
      </header>
      <div className="mx-auto w-full min-w-0" style={{ maxWidth: phone ? 390 : 1200 }}>
        <Preview
          key={scenario.id}
          initialMessages={scenario.messages}
          initialError={"error" in scenario ? scenario.error : undefined}
          initialWorking={"working" in scenario && scenario.working === true}
        />
      </div>
    </div>
  );
}

function Preview({
  initialMessages,
  initialWorking,
  initialError,
}: {
  initialMessages: ThreadMessage[];
  initialWorking: boolean;
  initialError?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [error, setError] = useState(initialError ?? null);
  const [working, setWorking] = useState(initialWorking);
  const [startedAt, setStartedAt] = useState(() => Date.now() - (initialWorking ? 65_000 : 0));
  const [drafts, setDrafts] = useState(new Map<string, ComposerDraft>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = drafts.get("gallery") ?? emptyComposerDraft();
  const lastAsk = messages.findLast((row) =>
    row.blocks.some((block) => block.kind === "ask" && block.status !== "answered"),
  );
  const stop = async () => setWorking(false);
  return (
    <main className="flex h-[calc(100dvh-5rem)] min-h-96 flex-col bg-background text-foreground">
      <Transcript
        scrollRef={scrollRef}
        artifactTarget={{ botId: BOT.botId }}
        messages={messages}
        olderCursor={null}
        loadingOlder={false}
        answerableAskMessageId={lastAsk?.id ?? null}
        running={working}
        stopPending={false}
        onStop={working && draft.text.trim() ? stop : undefined}
        workingBots={working ? [{ ...BOT, status: "running" }] : []}
        workingStartedAt={startedAt}
        onLoadOlder={noop}
        onOpenBot={noop}
        onAnswer={async (row, text) =>
          setMessages((current) =>
            current.map((item) =>
              item.id === row.id
                ? {
                    ...item,
                    blocks: item.blocks.map((block) =>
                      block.kind === "ask" ? { ...block, status: "answered", answer: text } : block,
                    ),
                  }
                : item,
            ),
          )
        }
        onReply={noop}
        onQuote={noop}
        onReact={resolved}
        onJumpToMessage={noop}
        onOpenPeerMessages={noop}
        peerBot={() => BOT}
        onRefresh={resolved}
        onBotChanged={resolved}
        onLessonSaved={noop}
        onAddRoutine={noop}
        voiceReady={false}
        speakingMessageId={null}
        onSpeak={noop}
        onOpenComputer={noop}
      />
      <Composer
        draftKey="gallery"
        drafts={drafts}
        setDrafts={setDrafts}
        activeName="Chief"
        running={working}
        canSend={Boolean(draft.text.trim())}
        pendingAttachments={[]}
        attachmentNotice={null}
        sendError={null}
        runError={error}
        runErrorId={error ? "gallery-failure" : null}
        onRunErrorPresented={noop}
        onDismissError={() => setError(null)}
        onChooseModel={noop}
        onOpenModels={noop}
        sending={false}
        fileInputRef={fileRef}
        onAttachmentPick={noop}
        onRemoveAttachment={noop}
        onSend={async (text) => {
          setMessages((current) => [...current, user(text)]);
          if (!working) setStartedAt(Date.now());
          setWorking(true);
          return true;
        }}
        onStop={stop}
      />
    </main>
  );
}

await bootstrapI18n("en");
applyResolvedAppearance(
  new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light",
);
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>
  </I18nProvider>,
);
