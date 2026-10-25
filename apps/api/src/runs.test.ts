import type { Actor } from "@engaz/contracts";
import type { PrismaClient } from "@engaz/db";
import { describe, expect, it, vi } from "vitest";
import {
  activityDecisionReason,
  activityEffectOutcome,
  activityNotificationsEnabled,
  activityPromptSnippet,
  getRunActivityDetails,
} from "./runs.js";

describe("run activity copy", () => {
  it("presents structured agent messages instead of their internal wake prompt", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] A message just arrived from another bot with internal routing data",
        sourceBlocks: [
          {
            kind: "bot_message_received",
            fromBotId: "maya",
            fromBotName: "Maya",
            text: "Please check the release workflow.",
            intent: "request",
          },
        ],
      }),
    ).toBe("Maya asked: Please check the release workflow.");
  });

  it("fails closed when an agent message has no valid structured source", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] private internal routing envelope",
        sourceBlocks: [{ kind: "text", text: "not a peer message" }],
      }),
    ).toBe("Message from another agent");
  });
});

describe("run activity notification preference", () => {
  it("silences only direct messages", () => {
    expect(activityNotificationsEnabled(null, false)).toBe(false);
    expect(activityNotificationsEnabled("group-1", false)).toBe(true);
  });
});

describe("activity decision details", () => {
  const actor = { userId: "user-1", spaceId: "space-1" } as Actor;
  it("scopes detail reads to the account and space before returning any actions", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      getRunActivityDetails({ run: { findFirst } } as unknown as PrismaClient, actor, "other-run"),
    ).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-run", userId: "user-1", spaceId: "space-1", bot: { archivedAt: null } },
      }),
    );
  });

  it("returns metadata without tool payloads or model review prose and keeps unknown history honest", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "run-1",
      taskId: "task-1",
      trigger: "bot_message",
      originRunId: null,
      originTrigger: null,
      routine: null,
      effects: [
        {
          id: "effect-1",
          kind: "send_message",
          status: "completed",
          decisionSource: null,
          decisionByUserId: null,
          request: { token: "secret-example" },
          result: { error: "secret-example" },
          reviewReason: "secret-example",
          updatedAt: new Date("2026-10-25T12:00:00Z"),
        },
      ],
    });
    const details = await getRunActivityDetails(
      { run: { findFirst } } as unknown as PrismaClient,
      actor,
      "run-1",
    );
    expect(details.originalTrigger).toBeNull();
    expect(details.effects[0]).toMatchObject({
      outcome: "failed",
      reason: "Decision context was not recorded.",
    });
    expect(JSON.stringify(details)).not.toContain("secret-example");
  });

  it("keeps source links within the same account and space", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: "run-1",
        taskId: "task-1",
        trigger: "bot_message",
        originRunId: "origin-1",
        originTrigger: "webhook",
        routine: null,
        effects: [],
      })
      .mockResolvedValueOnce(null);
    const details = await getRunActivityDetails(
      { run: { findFirst } } as unknown as PrismaClient,
      actor,
      "run-1",
    );
    expect(details).toMatchObject({ originalTrigger: "webhook", originRunId: null, source: null });
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "origin-1", userId: "user-1", spaceId: "space-1", bot: { archivedAt: null } },
      }),
    );
  });

  it("distinguishes permission, execution and uncertain outcomes", () => {
    expect(activityEffectOutcome({ status: "intended", decisionSource: "mandatory" })).toBe(
      "awaiting_approval",
    );
    expect(activityEffectOutcome({ status: "intended" })).toBe("requested");
    expect(activityEffectOutcome({ status: "approved" })).toBe("approved");
    expect(activityEffectOutcome({ status: "executing" })).toBe("attempted");
    expect(activityEffectOutcome({ status: "completed", result: { ok: false } })).toBe("failed");
    expect(activityEffectOutcome({ status: "completed", result: { ok: true } })).toBe("succeeded");
    expect(
      activityEffectOutcome({
        status: "completed",
        kind: "shell",
        result: { code: 1, stderr: "error" },
      }),
    ).toBe("failed");
    expect(activityEffectOutcome({ status: "denied" })).toBe("refused");
    expect(activityEffectOutcome({ status: "uncertain" })).toBe("unknown");
    expect(activityDecisionReason("user_deny")).toBe("Refused by a person.");
    expect(activityDecisionReason("not_offered")).toBe(
      "This tool was not available to the agent for this run.",
    );
  });
});
