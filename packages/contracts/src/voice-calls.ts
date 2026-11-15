import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

export const VoiceCallRecordInput = z
  .object({
    botId: Id,
    callId: z.string().uuid(),
    startedAt: IsoDate,
    endedAt: IsoDate,
    truncated: z.boolean().optional(),
    transcript: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().trim().min(1).max(20_000),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (value) => value.transcript.reduce((size, line) => size + line.text.length, 0) <= 1_000_000,
    "Call transcript is too large",
  )
  .refine(
    (value) =>
      Date.parse(value.endedAt) >= Date.parse(value.startedAt) &&
      Date.parse(value.endedAt) - Date.parse(value.startedAt) <= 24 * 60 * 60 * 1000,
    "Invalid call duration",
  );
export type VoiceCallRecordInput = z.infer<typeof VoiceCallRecordInput>;

export const RealtimeVoiceSessionSchema = z.object({
  transport: z.literal("openai-webrtc"),
  clientSecret: z.string(),
  expiresAt: z.number(),
  endpoint: z.literal("https://api.openai.com/v1/realtime/calls"),
});
export type RealtimeVoiceSession = z.infer<typeof RealtimeVoiceSessionSchema>;
