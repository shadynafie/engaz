import type { AgentSkillCatalogEntry, ThreadMessage } from "@engaz/contracts";
import { AgentSkillCatalogEntrySchema, ThreadMessageSchema } from "@engaz/contracts";
import type { ComposerMention } from "@engaz/core";
import { COMPOSER_MENTION_KINDS } from "@engaz/core";

export type ComposerDraft = {
  text: string;
  skill: AgentSkillCatalogEntry | null;
  mentions: ComposerMention[];
  reply: { target: ThreadMessage; quote: string | null } | null;
};

export function emptyComposerDraft(): ComposerDraft {
  return { text: "", skill: null, mentions: [], reply: null };
}

export function readComposerDraft(key: string): ComposerDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!saved || typeof saved.text !== "string" || !Array.isArray(saved.mentions)) {
      return emptyComposerDraft();
    }
    const mentions = saved.mentions.filter((mention: unknown): mention is ComposerMention => {
      if (!mention || typeof mention !== "object") return false;
      const row = mention as Record<string, unknown>;
      return (
        COMPOSER_MENTION_KINDS.some((kind) => kind === row.kind) &&
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        ["subtitle", "color", "botId", "connectionId"].every(
          (field) => row[field] === undefined || typeof row[field] === "string",
        ) &&
        (row.authStatus === undefined ||
          row.authStatus === "connected" ||
          row.authStatus === "needs_auth")
      );
    });
    const skill = AgentSkillCatalogEntrySchema.safeParse(saved.skill);
    const target = ThreadMessageSchema.safeParse(saved.reply?.target);
    const reply =
      target.success && (saved.reply.quote === null || typeof saved.reply.quote === "string")
        ? { target: target.data, quote: saved.reply.quote }
        : null;
    return { text: saved.text, skill: skill.success ? skill.data : null, mentions, reply };
  } catch {
    return emptyComposerDraft();
  }
}

export function saveComposerDraft(key: string, draft: ComposerDraft | null): void {
  try {
    if (draft && (draft.text || draft.skill || draft.mentions.length || draft.reply)) {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // The Shell also keeps drafts in memory when browser storage is unavailable.
  }
}

export type ChatSendAttempt = {
  signature: string;
  nonce: string;
  artifacts: Map<string, string>;
};

export function readChatSendAttempt(key: string): ChatSendAttempt | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      saved &&
      typeof saved.signature === "string" &&
      typeof saved.nonce === "string" &&
      Array.isArray(saved.artifacts) &&
      saved.artifacts.every(
        (entry: unknown) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((value) => typeof value === "string"),
      )
    )
      return { ...saved, artifacts: new Map(saved.artifacts) };
  } catch {
    // Retry protection remains available in memory if storage is unavailable.
  }
}

export function saveChatSendAttempt(key: string, attempt: ChatSendAttempt | null): void {
  try {
    if (attempt)
      sessionStorage.setItem(
        key,
        JSON.stringify({ ...attempt, artifacts: [...attempt.artifacts] }),
      );
    else sessionStorage.removeItem(key);
  } catch {
    // Retry protection remains available in memory if storage is unavailable.
  }
}

export function clearChatDrafts(userId: string): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (
        key.startsWith(`engaz:chat-draft:${userId}:`) ||
        key.startsWith(`engaz:chat-send:${userId}:`)
      ) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Unavailable storage contains no drafts this session could have saved.
  }
}
