import { messageWorkSummaries } from "@engaz/core";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { WorkSummary } from "../../src/components/WorkSummary";
import "../../src/styles.css";

i18n.loadAndActivate({ locale: "en", messages: {} });
const summary = messageWorkSummaries([
  {
    id: "reply",
    runId: "run",
    role: "bot",
    blocks: [
      {
        kind: "steps",
        steps: [
          { label: "Search", count: 2 },
          { label: "Read file", count: 1 },
        ],
      },
      { kind: "text", text: "The report is ready." },
      { kind: "progress", text: "private argument must stay hidden", activity: true },
    ],
  },
]).get("reply")!;

createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <main className="flex min-h-screen items-end bg-background p-6 text-foreground">
      <div className="max-w-full rounded-2xl bg-card p-4">
        <p>The report is ready.</p>
        <WorkSummary summary={summary} runId="run" />
      </div>
    </main>
  </I18nProvider>,
);
