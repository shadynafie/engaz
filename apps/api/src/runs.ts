import {
  type Actor,
  MessageBlock,
  type RunActivityDetails,
  type RunActivityRow,
} from "@engaz/contracts";
import { ACTIVE_RUN_STATUSES, botMessageContext } from "@engaz/core";
import type { PrismaClient } from "@engaz/db";
import { IsolationError } from "@engaz/db";

const RECENT_LIMIT = 20;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function promptSnippet(prompt: string, max = 120): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export function activityPromptSnippet(
  input: { trigger: string; prompt: string; sourceBlocks?: unknown },
  max = 120,
): string {
  if (input.trigger !== "bot_message") return promptSnippet(input.prompt, max);
  const parsed = MessageBlock.array().safeParse(input.sourceBlocks);
  const message = parsed.success ? botMessageContext(parsed.data) : undefined;
  if (!message) return "Message from another agent";
  const name = message.fromBotName.trim() || "Another agent";
  const label =
    message.intent === "result" || message.intent === "status" || message.intent === "fyi"
      ? `Update from ${name}`
      : `${name} asked`;
  return promptSnippet(message.text.trim() ? `${label}: ${message.text}` : label, max);
}

export function activityNotificationsEnabled(
  groupId: string | null,
  notifyOnFinish: boolean,
): boolean {
  return groupId !== null || notifyOnFinish;
}

export async function listSpaceRuns(
  prisma: PrismaClient,
  actor: Actor,
  filter: "active" | "recent",
): Promise<RunActivityRow[]> {
  const rows = await prisma.run.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      bot: { archivedAt: null },
      ...(filter === "active"
        ? { status: { in: [...ACTIVE_RUN_STATUSES] } }
        : { status: { in: [...TERMINAL_STATUSES] } }),
    },
    include: {
      bot: { select: { name: true, archivedAt: true, notifyOnFinish: true } },
      task: { select: { prompt: true } },
      sourceMessage: { select: { blocks: true } },
      thread: {
        select: {
          groupId: true,
          group: { select: { name: true } },
        },
      },
    },
    orderBy:
      filter === "active"
        ? [{ updatedAt: "desc" }, { id: "desc" }]
        : [{ completedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: filter === "recent" ? RECENT_LIMIT : undefined,
  });

  return rows.map((row) => ({
    runId: row.id,
    botId: row.botId,
    botName: row.bot.name,
    groupId: row.thread.groupId,
    groupName: row.thread.group?.name ?? null,
    threadId: row.threadId,
    status: row.status as RunActivityRow["status"],
    trigger: row.trigger as RunActivityRow["trigger"],
    notificationsEnabled: activityNotificationsEnabled(row.thread.groupId, row.bot.notifyOnFinish),
    promptSnippet: activityPromptSnippet({
      trigger: row.trigger,
      prompt: row.task.prompt,
      sourceBlocks: row.sourceMessage?.blocks,
    }),
    updatedAt: (filter === "recent" && row.completedAt
      ? row.completedAt
      : row.updatedAt
    ).toISOString(),
  }));
}

const EFFECT_DETAIL_LIMIT = 100;

/** Return only recorded metadata: tool arguments, results and model prose stay private. */
export async function getRunActivityDetails(
  prisma: PrismaClient,
  actor: Actor,
  runId: string,
): Promise<RunActivityDetails> {
  const run = await prisma.run.findFirst({
    where: { id: runId, spaceId: actor.spaceId, userId: actor.userId, bot: { archivedAt: null } },
    select: {
      id: true,
      taskId: true,
      trigger: true,
      originRunId: true,
      originTrigger: true,
      routine: { select: { id: true, name: true, userId: true, spaceId: true } },
      effects: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: EFFECT_DETAIL_LIMIT + 1,
        select: {
          id: true,
          kind: true,
          status: true,
          decisionSource: true,
          decisionByUserId: true,
          result: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!run) throw new IsolationError();
  const origin = run.originRunId
    ? await prisma.run.findFirst({
        where: {
          id: run.originRunId,
          userId: actor.userId,
          spaceId: actor.spaceId,
          bot: { archivedAt: null },
        },
        select: {
          id: true,
          botId: true,
          threadId: true,
          bot: { select: { name: true } },
          thread: { select: { groupId: true, group: { select: { name: true } } } },
          routine: { select: { id: true, name: true, userId: true, spaceId: true } },
        },
      })
    : null;
  const routine = run.routine ?? origin?.routine;
  return {
    runId: run.id,
    taskId: run.taskId,
    trigger: run.trigger,
    originalTrigger:
      run.originTrigger ??
      (["bot_message", "spawn", "follow_up", "resume"].includes(run.trigger) ? null : run.trigger),
    originRunId: origin?.id ?? null,
    source: origin
      ? {
          runId: origin.id,
          threadId: origin.threadId,
          botId: origin.botId,
          botName: origin.bot.name,
          groupId: origin.thread.groupId,
          groupName: origin.thread.group?.name ?? null,
        }
      : null,
    routine:
      routine?.userId === actor.userId && routine.spaceId === actor.spaceId
        ? { id: routine.id, name: routine.name }
        : null,
    authority: "Your account",
    effects: run.effects.slice(0, EFFECT_DETAIL_LIMIT).map((effect) => ({
      id: effect.id,
      tool: effect.kind.slice(0, 160),
      outcome: activityEffectOutcome(effect),
      reason: activityDecisionReason(effect.decisionSource),
      decidedByYou: effect.decisionByUserId === actor.userId,
      updatedAt: effect.updatedAt.toISOString(),
    })),
    moreEffects: run.effects.length > EFFECT_DETAIL_LIMIT,
  };
}

export function activityEffectOutcome(effect: {
  status: string;
  kind?: string;
  result?: unknown;
  decisionSource?: string | null;
}): RunActivityDetails["effects"][number]["outcome"] {
  switch (effect.status) {
    case "intended":
      return effect.decisionSource === "require_approval" ||
        effect.decisionSource === "mandatory" ||
        effect.decisionSource === "auto_review_ask"
        ? "awaiting_approval"
        : "requested";
    case "approved":
      return "approved";
    case "executing":
      return "attempted";
    case "completed": {
      const result = effect.result;
      return result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (("error" in result && result.error != null) ||
          ("ok" in result && result.ok === false) ||
          ("isError" in result && result.isError === true) ||
          (effect.kind === "shell" &&
            "code" in result &&
            typeof result.code === "number" &&
            result.code !== 0))
        ? "failed"
        : "succeeded";
    }
    case "denied":
      return "refused";
    case "uncertain":
      return "unknown";
    default:
      return "unknown";
  }
}

export function activityDecisionReason(source: string | null): string {
  switch (source) {
    case "default":
      return "Allowed by the default policy.";
    case "always_allow":
      return "Allowed by an always-allow rule.";
    case "require_approval":
      return "An approval rule requires permission.";
    case "mandatory":
      return "This action requires explicit permission.";
    case "auto_review_allow":
      return "Allowed by the configured action review.";
    case "auto_review_ask":
      return "The configured action review requires permission.";
    case "user_allow":
      return "Approved by a person.";
    case "user_deny":
      return "Refused by a person.";
    case "not_offered":
      return "This tool was not available to the agent for this run.";
    default:
      return "Decision context was not recorded.";
  }
}
