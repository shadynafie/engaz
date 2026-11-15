import type { AdapterContext } from "@engaz/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIVoiceProvider } from "./openai-voice.js";

const context = {
  operationId: "voice",
  traceId: "voice",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
} as AdapterContext;
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI live voice", () => {
  it("mints a short-lived key with automatic model replies and tools disabled", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ value: "ephemeral-test", expires_at: 123 })),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await new OpenAIVoiceProvider().createRealtimeSession(
      { apiKey: "private-key", voiceId: "nova" },
      context,
    );
    expect(result.clientSecret).toBe("ephemeral-test");
    expect(result).not.toHaveProperty("apiKey");
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.expires_after.seconds).toBe(60);
    expect(body.session.audio.input.turn_detection).toMatchObject({
      create_response: false,
      interrupt_response: true,
    });
    expect(body.session.tools).toEqual([]);
    expect(body.session.audio.output.voice).toBe("alloy");
  });
  it("rejects malformed upstream tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(
      new OpenAIVoiceProvider().createRealtimeSession({ apiKey: "key", voiceId: "alloy" }, context),
    ).rejects.toThrow("invalid session");
  });
});
