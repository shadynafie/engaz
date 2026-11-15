import { VoiceCallRecordInput } from "@engaz/contracts";
import { describe, expect, it } from "vitest";
import { appendVoiceCallLine, voiceCallMarkdown } from "./voice-call-record.js";

const record = {
  botId: "bot-1",
  callId: "c6365a88-42d9-4e6b-9afd-e9d434941a2a",
  startedAt: "2026-01-01T12:00:00.000Z",
  endedAt: "2026-01-01T12:01:00.000Z",
  transcript: [
    { role: "user" as const, text: "Check the report" },
    { role: "assistant" as const, text: "The report is ready.\n# Untrusted heading" },
  ],
};

describe("voice call records", () => {
  it("uses exact excerpts for the summary and quotes transcript content", () => {
    const markdown = voiceCallMarkdown(record, "Chief");
    expect(markdown).toContain("Duration: 60s");
    expect(markdown).toContain("Request:\n\n> Check the report");
    expect(markdown).toContain("> The report is ready.\n> # Untrusted heading");
    expect(markdown).not.toContain("\n# Untrusted heading");
  });
  it("segments long speech and marks the bounded transcript instead of failing at hangup", () => {
    const bounded = { ...record, transcript: [] as typeof record.transcript, truncated: false };
    appendVoiceCallLine(bounded, "assistant", "x".repeat(25_000));
    expect(bounded.transcript.map((line) => line.text.length)).toEqual([20_000, 5_000]);
    for (let i = 0; i < 200; i += 1) appendVoiceCallLine(bounded, "user", "hello");
    expect(bounded.transcript).toHaveLength(200);
    expect(bounded.truncated).toBe(true);
    expect(VoiceCallRecordInput.safeParse(bounded).success).toBe(true);
    expect(voiceCallMarkdown(bounded, "Chief")).toContain("Transcript shortened");
  });
  it("rejects oversized transcripts, negative duration and empty calls", () => {
    expect(VoiceCallRecordInput.safeParse(record).success).toBe(true);
    expect(
      VoiceCallRecordInput.safeParse({ ...record, endedAt: "2025-01-01T12:00:00.000Z" }).success,
    ).toBe(false);
    expect(VoiceCallRecordInput.safeParse({ ...record, transcript: [] }).success).toBe(false);
    expect(
      VoiceCallRecordInput.safeParse({
        ...record,
        transcript: [{ role: "user", text: "x".repeat(20001) }],
      }).success,
    ).toBe(false);
  });
});
