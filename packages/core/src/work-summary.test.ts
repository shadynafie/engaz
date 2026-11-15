import type { MessageBlock } from "@engaz/contracts";
import { describe, expect, it } from "vitest";
import { messageWorkSummaries } from "./work-summary.js";

const message = (id: string, runId: string, blocks: MessageBlock[], role = "bot") => ({
  id,
  runId,
  role,
  blocks,
});
const steps = (label: string, count = 1): MessageBlock => ({
  kind: "steps",
  steps: [{ label, count }],
});

describe("message work summaries", () => {
  it("groups persisted actions once on the last visible reply in each run", () => {
    const result = messageWorkSummaries([
      message("a", "run", [steps("Browser", 2), { kind: "text", text: "Checking." }]),
      message("b", "other", [steps("Search"), { kind: "text", text: "Found." }]),
      message("c", "run", [steps("Browser"), steps("Read file")]),
      message("d", "run", [{ kind: "text", text: "Done." }]),
    ]);
    expect([...result.keys()]).toEqual(["d", "b"]);
    expect(result.get("d")).toEqual({
      count: 4,
      steps: [
        { label: "Browser", count: 3 },
        { label: "Read file", count: 1 },
      ],
    });
  });

  it("ignores live duplicates, active runs, user content, and private progress", () => {
    const result = messageWorkSummaries(
      [
        message("progress:run", "run", [steps("Duplicate", 3)]),
        message("user", "run", [steps("User supplied")], "user"),
        message("reply", "run", [
          steps("Browser"),
          { kind: "progress", text: "private argument", activity: true },
          { kind: "text", text: "Done." },
        ]),
        message("active", "active", [steps("Working"), { kind: "text", text: "Checking." }]),
      ],
      ["active"],
    );
    expect([...result]).toEqual([["reply", { count: 1, steps: [{ label: "Browser", count: 1 }] }]]);
  });

  it("does not invent summaries for narration, tool-only turns, or invalid counts", () => {
    expect(
      messageWorkSummaries([
        message("text", "text", [{ kind: "text", text: "Hello" }]),
        message("tool", "tool", [steps("Browser")]),
        message("invalid", "invalid", [
          steps("Bad", 0),
          steps("Bad", -2),
          { kind: "text", text: "Done" },
        ]),
      ]).size,
    ).toBe(0);
  });
});
