import type { MessageBlock } from "@engaz/contracts";
import { isToolActivityBlock } from "./tool-activity.js";

export type WorkSummary = { count: number; steps: { label: string; count: number }[] };

type SummaryMessage = {
  id: string;
  runId?: string;
  role: string;
  blocks: readonly MessageBlock[];
};

/** Summarize persisted tool names only; progress text, arguments, and results stay private. */
export function messageWorkSummaries(
  messages: readonly SummaryMessage[],
  activeRunIds: readonly string[] = [],
): Map<string, WorkSummary> {
  const active = new Set(activeRunIds);
  const runs = new Map<string, { messageId?: string; steps: Map<string, number> }>();
  for (const message of messages) {
    if (
      !message.runId ||
      message.role !== "bot" ||
      message.id.startsWith("progress:") ||
      active.has(message.runId)
    )
      continue;
    let run = runs.get(message.runId);
    if (!run) {
      run = { steps: new Map() };
      runs.set(message.runId, run);
    }
    if (message.blocks.some((block) => !isToolActivityBlock(block))) run.messageId = message.id;
    for (const block of message.blocks) {
      if (block.kind !== "steps") continue;
      for (const step of block.steps) {
        if (!step.label.trim() || !Number.isSafeInteger(step.count) || step.count <= 0) continue;
        run.steps.set(step.label, (run.steps.get(step.label) ?? 0) + step.count);
      }
    }
  }
  const summaries = new Map<string, WorkSummary>();
  for (const run of runs.values()) {
    if (!run.messageId || run.steps.size === 0) continue;
    const steps = [...run.steps].map(([label, count]) => ({ label, count }));
    summaries.set(run.messageId, {
      count: steps.reduce((sum, step) => sum + step.count, 0),
      steps,
    });
  }
  return summaries;
}
