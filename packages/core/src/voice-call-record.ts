import type { VoiceCallRecordInput } from "@engaz/contracts";

/** Extractive summary: it never invents a result or adds another model request. */
export function voiceCallMarkdown(record: VoiceCallRecordInput, botName: string): string {
  const quote = (text: string) =>
    text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  const excerpt = (text: string) => (text.length <= 240 ? text : `${text.slice(0, 237)}…`);
  const request = record.transcript.find((line) => line.role === "user");
  const reply = [...record.transcript].reverse().find((line) => line.role === "assistant");
  const seconds = Math.round((Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000);
  return `${[
    `# Voice call with ${botName.replace(/[\r\n]/g, " ")}`,
    `Started: ${record.startedAt}\n\nDuration: ${seconds}s\n\nCall: ${record.callId}`,
    "## Summary",
    ...(request ? [`Request:\n\n${quote(excerpt(request.text))}`] : []),
    ...(reply ? [`Last reply:\n\n${quote(excerpt(reply.text))}`] : []),
    "## Transcript",
    ...(record.truncated ? ["Transcript shortened at the recording limit."] : []),
    ...record.transcript.map(
      (line) => `**${line.role === "user" ? "You" : "Agent"}**\n\n${quote(line.text)}`,
    ),
  ].join("\n\n")}\n`;
}

/** Keep the saved transcript within the API's bounds, with an explicit truncation marker. */
export function appendVoiceCallLine(
  record: VoiceCallRecordInput,
  role: "user" | "assistant",
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  let remaining = 1_000_000 - record.transcript.reduce((size, line) => size + line.text.length, 0);
  let offset = 0;
  while (offset < trimmed.length && record.transcript.length < 200 && remaining > 0) {
    const chunk = trimmed.slice(offset, offset + Math.min(20_000, remaining));
    if (chunk.trim()) record.transcript.push({ role, text: chunk });
    offset += chunk.length;
    remaining -= chunk.length;
  }
  if (offset < trimmed.length) record.truncated = true;
}
