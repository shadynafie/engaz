import { createHash } from "node:crypto";
import type { ArtifactStore } from "@engaz/adapter-kit";
import type { Actor, VoiceCallRecordInput } from "@engaz/contracts";
import { voiceCallMarkdown } from "@engaz/core";
import type { PrismaClient } from "@engaz/db";
import { IsolationError } from "@engaz/db";
import { createOwnedArtifact } from "./artifacts.js";

export async function saveVoiceCall(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  actor: Actor,
  input: VoiceCallRecordInput,
): Promise<{ id: string }> {
  const bot = await deps.prisma.bot.findFirst({
    where: { id: input.botId, userId: actor.userId, spaceId: actor.spaceId },
    select: { name: true },
  });
  if (!bot) throw new IsolationError();
  const content = voiceCallMarkdown(input, bot.name);
  const id = `voice_${createHash("sha256")
    .update(JSON.stringify([actor.spaceId, actor.userId, input.botId, input.callId]))
    .digest("hex")}`;
  const existing = await deps.prisma.artifact.findFirst({
    where: { botId: input.botId, userId: actor.userId, spaceId: actor.spaceId, id },
    select: { id: true },
  });
  if (existing) return existing;
  const artifact = await createOwnedArtifact(deps, actor, {
    id,
    botId: input.botId,
    name: `voice-call-${input.startedAt.slice(0, 19).replace(/:/g, "-")}-${input.callId.slice(0, 8)}.md`,
    mimeType: "text/markdown",
    contentBase64: Buffer.from(content).toString("base64"),
  }).catch(async (error) => {
    // Concurrent retries share one primary key; the losing upload is removed by createOwnedArtifact.
    const saved = await deps.prisma.artifact.findFirst({
      where: { id, botId: input.botId, userId: actor.userId, spaceId: actor.spaceId },
      select: { id: true },
    });
    if (saved) return saved;
    throw error;
  });
  return { id: artifact.id };
}
