import type { AgentRunRequest, AgentRuntimeEvent } from "@engaz/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scenario = vi.hoisted(() => ({
  turns: [] as Array<{ text: string; tool?: boolean; stopReason?: string }>,
  reviews: [] as Array<string | Error>,
  followUps: [] as string[],
  reviewInputs: [] as string[],
  reviewStarted: undefined as (() => void) | undefined,
  releaseReview: undefined as Promise<void> | undefined,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { messages: [] as unknown[], errorMessage: undefined };
    private listeners: Array<(event: unknown) => Promise<void>> = [];
    private tools: Array<{ name: string; execute: (id: string, args: object) => Promise<unknown> }>;
    private prepareNextTurnWithContext?: () => Promise<unknown>;

    constructor(options: {
      initialState: {
        messages: unknown[];
        tools: Array<{ name: string; execute: (id: string, args: object) => Promise<unknown> }>;
      };
      prepareNextTurnWithContext?: () => Promise<unknown>;
    }) {
      this.state.messages = [...options.initialState.messages];
      this.tools = options.initialState.tools;
      this.prepareNextTurnWithContext = options.prepareNextTurnWithContext;
    }

    subscribe(listener: (event: unknown) => Promise<void>) {
      this.listeners.push(listener);
    }

    private async emit(event: unknown) {
      for (const listener of this.listeners) await listener(event);
    }

    async prompt() {
      const tool = this.tools.find((item) => item.name === "shell")!;
      const first = {
        role: "assistant",
        content: [
          { type: "text", text: "Checking." },
          { type: "toolCall", id: "tool-0", name: "shell", arguments: { command: "check" } },
        ],
      };
      await this.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Checking." },
      });
      this.state.messages.push(first);
      await this.emit({ type: "message_end", message: first });
      await this.emit({
        type: "tool_execution_start",
        toolName: "shell",
        args: { command: "check" },
      });
      await tool.execute("tool-0", { command: "check" });
      this.state.messages.push({
        role: "toolResult",
        toolName: "shell",
        isError: false,
        content: [{ type: "text", text: "check passed" }],
      });
      await this.emit({ type: "turn_end", message: first, toolResults: [{}] });

      for (let index = 0; index < scenario.turns.length; index += 1) {
        await this.prepareNextTurnWithContext?.();
        const turn = scenario.turns[index]!;
        const message = {
          role: "assistant",
          stopReason: turn.stopReason ?? "stop",
          content: [
            { type: "text", text: turn.text },
            ...(turn.tool
              ? [
                  {
                    type: "toolCall",
                    id: `tool-${index + 1}`,
                    name: "shell",
                    arguments: { command: "more" },
                  },
                ]
              : []),
          ],
        };
        await this.emit({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: turn.text },
        });
        this.state.messages.push(message);
        await this.emit({ type: "message_end", message });
        if (turn.tool) {
          await this.emit({
            type: "tool_execution_start",
            toolName: "shell",
            args: { command: "more" },
          });
          await tool.execute(`tool-${index + 1}`, { command: "more" });
          this.state.messages.push({
            role: "toolResult",
            toolName: "shell",
            isError: false,
            content: [{ type: "text", text: "more passed" }],
          });
          await this.emit({ type: "turn_end", message, toolResults: [{}] });
        } else {
          await this.emit({ type: "turn_end", message, toolResults: [] });
          if (index + 1 < scenario.turns.length && scenario.followUps.length <= index) break;
        }
      }
    }

    async waitForIdle() {}

    followUp(message: { content: string }) {
      scenario.followUps.push(message.content);
    }

    steer(message: unknown) {
      this.state.messages.push(message);
    }

    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: () => ({ provider: "test", id: "completion-model", api: "openai-completions" }),
    streamSimple: () => {
      throw new Error("The fake agent handles its own turns");
    },
    completeSimple: async (_model: unknown, context: { messages: Array<{ content: string }> }) => {
      scenario.reviewInputs.push(context.messages[0]!.content);
      scenario.reviewStarted?.();
      await scenario.releaseReview;
      const next = scenario.reviews.shift() ?? '{"status":"complete"}';
      if (next instanceof Error) throw next;
      return {
        role: "assistant",
        content: [{ type: "text", text: next }],
        stopReason: "stop",
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
      };
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({ registerLocalProvider: (models: unknown) => models }));
vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime } from "./pi-runtime.js";

const request: AgentRunRequest = {
  botId: "bot",
  threadId: "thread",
  runId: "run",
  prompt: "Run the check and finish the task.",
  instructions: "Report only after the work is done.",
  history: [],
  tools: [
    {
      name: "shell",
      description: "Run a command",
      inputSchema: { type: "object", properties: { command: { type: "string" } } },
    },
  ],
  model: { provider: "test", id: "completion-model" },
  executeTool: async () => ({ ok: true }),
};

async function collect(overrides: Partial<AgentRunRequest> = {}) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of new PiAgentRuntime().run({ ...request, ...overrides }))
    events.push(event);
  return events;
}

beforeEach(() => {
  scenario.turns = [];
  scenario.reviews = [];
  scenario.followUps = [];
  scenario.reviewInputs = [];
  scenario.reviewStarted = undefined;
  scenario.releaseReview = undefined;
});

describe("Pi completion review", () => {
  it("holds a candidate until completion is verified and accounts for review usage", async () => {
    scenario.turns = [{ text: "The task is done." }];
    let markReviewStarted!: () => void;
    const reviewStarted = new Promise<void>((resolve) => {
      markReviewStarted = resolve;
    });
    scenario.reviewStarted = markReviewStarted;
    let releaseReview!: () => void;
    scenario.releaseReview = new Promise<void>((resolve) => {
      releaseReview = resolve;
    });
    const events: AgentRuntimeEvent[] = [];
    const work = (async () => {
      for await (const event of new PiAgentRuntime().run(request)) events.push(event);
    })();
    await reviewStarted;
    expect(events).not.toContainEqual({ type: "text", text: "The task is done." });
    releaseReview();
    await work;
    expect(events).toContainEqual({ type: "text", text: "The task is done." });
    expect(events).toContainEqual({
      type: "usage",
      inputTokens: 10,
      outputTokens: 2,
      provider: "test",
      model: "completion-model",
    });
    expect(scenario.reviewInputs[0]).toContain("check passed");
  });

  it("rejects an early answer and continues the same agent until a later answer passes", async () => {
    scenario.turns = [{ text: "Probably done." }, { text: "The verified result is ready." }];
    scenario.reviews = [
      '{"status":"continue","reason":"Verify the result"}',
      '{"status":"complete"}',
    ];
    const events = await collect();
    expect(scenario.followUps).toHaveLength(1);
    expect(scenario.followUps[0]).toContain("Verify the result");
    expect(events).not.toContainEqual({ type: "text", text: "Probably done." });
    expect(events).toContainEqual({ type: "text", text: "The verified result is ready." });
    expect(scenario.reviewInputs).toHaveLength(2);
  });

  it.each([
    ['{"status":"needs_user","question":"Which account should I use?"}', "ask"],
    ['{"status":"blocked","reason":"The service is unavailable."}', "blocked"],
  ])("handles %s without publishing the candidate", async (review, outcome) => {
    scenario.turns = [{ text: "All set." }];
    scenario.reviews = [review];
    const events = await collect();
    expect(events).not.toContainEqual({ type: "text", text: "All set." });
    if (outcome === "ask") {
      expect(events).toContainEqual({ type: "ask", text: "Which account should I use?" });
    } else {
      expect(events).toContainEqual({
        type: "text",
        text: "I couldn't complete the task: The service is unavailable.",
      });
    }
  });

  it("stops after three review continuations", async () => {
    scenario.turns = Array.from({ length: 4 }, (_, index) => ({ text: `Candidate ${index}` }));
    scenario.reviews = Array.from(
      { length: 4 },
      () => '{"status":"continue","reason":"More work remains."}',
    );
    const events = await collect();
    expect(scenario.followUps).toHaveLength(3);
    expect(events).not.toContainEqual({ type: "text", text: "Candidate 3" });
    expect(events).toContainEqual({
      type: "text",
      text: "I couldn't verify that the task was complete. Please ask me to continue.",
    });
  });

  it.each([
    [new Error("provider unavailable"), "The completion check failed."],
    ["not JSON", "The completion check returned no usable decision."],
  ])("stops cleanly when review fails or is malformed", async (review, reason) => {
    scenario.turns = [{ text: "All set." }];
    scenario.reviews = [review];
    const events = await collect();
    expect(events).not.toContainEqual({ type: "text", text: "All set." });
    expect(events).toContainEqual({
      type: "text",
      text: `I couldn't complete the task: ${reason}`,
    });
  });

  it("continues a truncated answer without asking the reviewer to certify it", async () => {
    scenario.turns = [
      { text: "Only part of the answer", stopReason: "length" },
      { text: "The complete answer." },
    ];
    const events = await collect();
    expect(scenario.followUps).toHaveLength(1);
    expect(scenario.reviewInputs).toHaveLength(1);
    expect(events).not.toContainEqual({ type: "text", text: "Only part of the answer" });
    expect(events).toContainEqual({ type: "text", text: "The complete answer." });
  });

  it("preserves an explicitly silent run's response behavior", async () => {
    scenario.turns = [{ text: "NO_RESPONSE" }];
    const events = await collect({ allowSilentEmpty: true });
    expect(scenario.reviewInputs).toHaveLength(0);
    expect(events).toContainEqual({ type: "text", text: "NO_RESPONSE" });
  });

  it("still reviews a substantive response from a silent-capable run", async () => {
    scenario.turns = [{ text: "The task is done." }];
    const events = await collect({ allowSilentEmpty: true });
    expect(scenario.reviewInputs).toHaveLength(1);
    expect(events).toContainEqual({ type: "text", text: "The task is done." });
  });

  it("includes new user steering in the completion check", async () => {
    scenario.turns = [{ text: "The final result." }];
    let claims = 0;
    await collect({
      claimSteering: async () =>
        ++claims === 1
          ? []
          : [{ id: "steer-1", messageId: "message-1", text: "Also verify the second item." }],
    });
    expect(scenario.reviewInputs[0]).toContain("Also verify the second item.");
  });

  it("streams narration before a later tool and reviews only the next final answer", async () => {
    scenario.turns = [
      { text: "I need another check.", tool: true },
      { text: "Both checks passed." },
    ];
    const events = await collect();
    const narration = events.findIndex(
      (event) => event.type === "text" && event.text === "I need another check.",
    );
    const secondTool = events.findIndex(
      (event) => event.type === "tool" && event.executionId === "tool-1",
    );
    expect(narration).toBeGreaterThan(-1);
    expect(secondTool).toBeGreaterThan(narration);
    expect(scenario.reviewInputs).toHaveLength(1);
    expect(events).toContainEqual({ type: "text", text: "Both checks passed." });
  });
});
