import { describe, expect, it, vi } from "vitest";
import { previewLesson, proposeLesson } from "./lesson-proposals.js";

const actor = { spaceId: "space-1", userId: "user-1" };
function fixture() {
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    status: "completed",
    task: { id: "task-1", prompt: "Prepare the scheduled report." },
    sourceMessage: {
      id: "question",
      role: "user",
      blocks: [
        { kind: "text", text: "Prepare a report. private-model-key private-agent-secret" },
        { kind: "ask", text: "protected-value" },
      ],
    },
  };
  const model = {
    provider: "scripted",
    id: "scripted",
    apiKey: "private-model-key",
    baseUrl: undefined as string | undefined,
  };
  const prisma = {
    run: { findFirst: vi.fn(async () => run) },
    message: {
      findMany: vi.fn(async () => [
        {
          id: "answer",
          role: "bot",
          blocks: [
            { kind: "text", text: "Report completed. Keep evidence separate from guesses." },
            { kind: "tool_result", output: "hidden-tool-payload" },
          ],
        },
      ]),
    },
    agentSecret: {
      findMany: vi.fn(async () => [
        { name: "TEST_SECRET", secret: { id: "secret-1", ciphertext: "encrypted" } },
      ]),
    },
    usageRecord: { create: vi.fn() },
    agentSkill: { create: vi.fn(), update: vi.fn() },
  };
  const runtime = {
    run: vi.fn(async function* () {
      yield {
        type: "usage",
        provider: "scripted",
        model: "scripted",
        inputTokens: 10,
        outputTokens: 20,
      };
      yield {
        type: "done",
        text: JSON.stringify({
          name: "evidence-led-report",
          description: "When writing reports",
          body: "Separate evidence from guesses.",
        }),
      };
    }),
  };
  const deps = {
    prisma: prisma as never,
    lessonModel: { runtime: runtime as never, resolveModel: vi.fn(async () => model) },
    secrets: { load: vi.fn(() => "private-agent-secret") },
  };
  return { deps, prisma, runtime, run, model };
}

describe("lesson proposals", () => {
  it("previews only text from an owned completed run without calling a model or saving a skill", async () => {
    const { deps, prisma, runtime } = fixture();
    const preview = await previewLesson(deps, actor, "run-1");
    expect(prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-1",
          ...actor,
          bot: actor,
        },
      }),
    );
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          threadId: "thread-1",
          runId: "run-1",
          role: { in: ["user", "bot"] },
        },
      }),
    );
    expect(JSON.stringify(preview.evidence)).not.toMatch(
      /private-|protected-value|hidden-tool-payload/,
    );
    expect(preview.evidence[0]?.text).toContain("[redacted]");
    expect(runtime.run).not.toHaveBeenCalled();
    expect(prisma.agentSkill.create).not.toHaveBeenCalled();
  });

  it("requires the exact reviewed source and model before generation", async () => {
    const { deps, runtime, model } = fixture();
    const preview = await previewLesson(deps, actor, "run-1");
    model.id = "changed-model";
    await expect(
      proposeLesson(deps, actor, { runId: "run-1", reviewKey: preview.reviewKey }),
    ).rejects.toThrow("changed");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("binds review to the model and full compatible endpoint on the same provider", async () => {
    const { deps, model, runtime } = fixture();
    model.provider = "openai-compatible";
    model.id = "model-a";
    model.baseUrl = "https://models.example.test/v1";
    const original = await previewLesson(deps, actor, "run-1");
    model.id = "model-b";
    await expect(
      proposeLesson(deps, actor, { runId: "run-1", reviewKey: original.reviewKey }),
    ).rejects.toThrow("changed");
    model.id = "model-a";
    model.baseUrl = "https://models.example.test/other/v1";
    await expect(
      proposeLesson(deps, actor, { runId: "run-1", reviewKey: original.reviewKey }),
    ).rejects.toThrow("changed");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("includes the source task for a scheduled run without a source message", async () => {
    const { deps, run } = fixture();
    run.sourceMessage = null as never;
    const preview = await previewLesson(deps, actor, "run-1");
    expect(preview.evidence[0]).toEqual({
      messageId: "task-1",
      role: "task",
      text: "Prepare the scheduled report.",
    });
  });

  it("bounds evidence and tells the reviewer when it omitted text", async () => {
    const { deps, run } = fixture();
    run.sourceMessage.blocks = [{ kind: "text", text: "x".repeat(17_000) }];
    const preview = await previewLesson(deps, actor, "run-1");
    expect(preview.truncated).toBe(true);
    expect(preview.evidence.map((entry) => entry.text).join("")).toHaveLength(16_000);
  });

  it("passes corrections as untrusted evidence with no tools, and leaves saving to explicit approval", async () => {
    const { deps, runtime, prisma } = fixture();
    const preview = await previewLesson(deps, actor, "run-1");
    const draft = await proposeLesson(deps, actor, {
      runId: "run-1",
      reviewKey: preview.reviewKey,
      corrections: "Do not invent sources. private-agent-secret",
    });
    expect(draft.name).toBe("evidence-led-report");
    expect(runtime.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [],
        history: [],
        instructions: expect.stringContaining("untrusted"),
        prompt: expect.stringContaining("Do not invent sources. [redacted]"),
      }),
      expect.objectContaining(actor),
    );
    expect(prisma.usageRecord.create).toHaveBeenCalledOnce();
    expect(prisma.agentSkill.create).not.toHaveBeenCalled();
    expect(prisma.agentSkill.update).not.toHaveBeenCalled();
  });

  it("rejects missing and unfinished runs before resolving credentials", async () => {
    const { deps, run, prisma } = fixture();
    run.status = "running";
    await expect(previewLesson(deps, actor, "run-1")).rejects.toThrow("completed");
    expect(deps.lessonModel.resolveModel).not.toHaveBeenCalled();
    prisma.run.findFirst.mockResolvedValueOnce(null as never);
    await expect(previewLesson(deps, actor, "someone-elses-run")).rejects.toThrow();
  });

  it("reports unavailable models and malformed output without leaking provider errors", async () => {
    const { deps, runtime } = fixture();
    const preview = await previewLesson(deps, actor, "run-1");
    runtime.run.mockImplementationOnce(async function* () {
      yield { type: "done", text: "" } as never;
      throw new Error("private-provider-details");
    });
    await expect(
      proposeLesson(deps, actor, { runId: "run-1", reviewKey: preview.reviewKey }),
    ).rejects.toThrow("Could not draft");
    runtime.run.mockImplementationOnce(async function* () {
      yield { type: "done", text: "not JSON" } as never;
    });
    await expect(
      proposeLesson(deps, actor, { runId: "run-1", reviewKey: preview.reviewKey }),
    ).rejects.toThrow("usable skill");
    deps.lessonModel.resolveModel.mockRejectedValueOnce(new Error("private-provider-details"));
    await expect(previewLesson(deps, actor, "run-1")).rejects.toThrow("Connect a model");
  });
});
