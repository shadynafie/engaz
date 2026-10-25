import * as z from "zod";
import { Id } from "./ids.js";

export const LessonEvidenceSchema = z.object({
  messageId: Id,
  role: z.string(),
  text: z.string().max(16_000),
});
export type LessonEvidence = z.infer<typeof LessonEvidenceSchema>;

export const LessonPreviewSchema = z.object({
  botId: Id,
  evidence: z.array(LessonEvidenceSchema).max(41),
  truncated: z.boolean().optional(),
  modelLabel: z.string(),
  reviewKey: z.string().length(64),
});
export type LessonPreview = z.infer<typeof LessonPreviewSchema>;

export const LessonDraftSchema = LessonPreviewSchema.extend({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(2_000),
  body: z.string().max(16_000),
});
export type LessonDraft = z.infer<typeof LessonDraftSchema>;
