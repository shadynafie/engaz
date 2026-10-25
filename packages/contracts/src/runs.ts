import * as z from "zod";
import { Id, RunStatus } from "./ids.js";

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: z.enum([
    "user",
    "routine",
    "resume",
    "follow_up",
    "reaction",
    "spawn",
    "skill",
    "bot_message",
    "webhook",
    "messaging",
    "cloud_agent",
  ]),
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;

export const RunActivityDetailsSchema = z.object({
  runId: Id,
  taskId: Id,
  trigger: z.string(),
  originalTrigger: z.string().nullable(),
  originRunId: Id.nullable(),
  source: z
    .object({
      runId: Id,
      threadId: Id,
      botId: Id,
      botName: z.string(),
      groupId: Id.nullable(),
      groupName: z.string().nullable(),
    })
    .nullable(),
  routine: z.object({ id: Id, name: z.string() }).nullable(),
  authority: z.literal("Your account"),
  effects: z.array(
    z.object({
      id: Id,
      tool: z.string(),
      outcome: z.enum([
        "requested",
        "awaiting_approval",
        "approved",
        "attempted",
        "succeeded",
        "failed",
        "refused",
        "unknown",
      ]),
      reason: z.string(),
      decidedByYou: z.boolean(),
      updatedAt: z.string(),
    }),
  ),
  moreEffects: z.boolean(),
});
export type RunActivityDetails = z.infer<typeof RunActivityDetailsSchema>;
