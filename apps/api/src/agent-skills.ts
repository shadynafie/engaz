import type { Actor, AgentSkill, AgentSkillSource } from "@engaz/contracts";
import {
  buildSkillMd,
  findSkillByName,
  isSkillReadOnly,
  parseSkillMd,
  type SkillSource,
} from "@engaz/core";
import { IsolationError, type PrismaClient } from "@engaz/db";
import { ORPCError } from "@orpc/server";

type AgentSkillRow = {
  id: string;
  name: string;
  description: string;
  content: string;
  source: string;
  bots: { botId: string }[];
  createdAt: Date;
  updatedAt: Date;
};

const withBots = { bots: { select: { botId: true }, orderBy: { createdAt: "asc" as const } } };

function asSource(value: string): AgentSkillSource {
  if (value === "plugin" || value === "user") return value;
  return "user";
}

export function mapAgentSkill(row: AgentSkillRow): AgentSkill {
  const source = asSource(row.source);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    source,
    readOnly: isSkillReadOnly(source as SkillSource),
    botIds: row.bots.map((bot) => bot.botId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function resolveSkillContent(input: {
  content?: string;
  name?: string;
  description?: string;
  body?: string;
  prior?: { content: string };
}): { name: string; description: string; content: string } {
  const ensureContentLimit = (content: string): string => {
    if (content.length > 100_000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Skill content must be at most 100000 characters.",
      });
    }
    return content;
  };

  if (input.content?.trim()) {
    const parsed = parseSkillMd(input.content);
    if ("error" in parsed) {
      throw new ORPCError("BAD_REQUEST", { message: parsed.error });
    }
    return {
      name: parsed.name,
      description: parsed.description,
      content: ensureContentLimit(buildSkillMd(parsed)),
    };
  }

  const priorParsed = input.prior ? parseSkillMd(input.prior.content) : null;
  if (priorParsed && "error" in priorParsed) {
    throw new ORPCError("BAD_REQUEST", { message: priorParsed.error });
  }

  const name = (input.name ?? priorParsed?.name ?? "").trim();
  const description = (input.description ?? priorParsed?.description ?? "").trim();
  const body = input.body ?? priorParsed?.body ?? "";
  if (!name || !description) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Provide content (SKILL.md) or name + description (+ optional body)",
    });
  }
  let content: string;
  try {
    content = buildSkillMd({
      name,
      description,
      body,
      frontmatter: priorParsed && !("error" in priorParsed) ? priorParsed.frontmatter : undefined,
    });
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Invalid skill fields.",
    });
  }
  const validated = parseSkillMd(content);
  if ("error" in validated) {
    throw new ORPCError("BAD_REQUEST", { message: validated.error });
  }
  return {
    name: validated.name,
    description: validated.description,
    content: ensureContentLimit(buildSkillMd(validated)),
  };
}

export function createAgentSkillsService(prisma: PrismaClient) {
  async function owned(actor: Actor, skillId: string) {
    const row = await prisma.agentSkill.findFirst({
      where: {
        id: skillId,
        spaceId: actor.spaceId,
        userId: actor.userId,
      },
      include: withBots,
    });
    if (!row) throw new IsolationError();
    return row;
  }

  async function ownedBot(actor: Actor, botId: string) {
    const bot = await prisma.bot.findFirst({
      where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
      select: { id: true },
    });
    if (!bot) throw new IsolationError();
    return bot;
  }

  function scope(actor: Actor, botId?: string) {
    return {
      spaceId: actor.spaceId,
      userId: actor.userId,
      ...(botId ? { bots: { some: { botId } } } : {}),
    };
  }

  return {
    async list(actor: Actor, botId?: string): Promise<Omit<AgentSkill, "content">[]> {
      const rows = await prisma.agentSkill.findMany({
        where: scope(actor, botId),
        include: withBots,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map(mapAgentSkill).map(({ content: _content, ...entry }) => entry);
    },

    /** With botId, only the skills that agent receives. */
    async listWithContent(actor: Actor, botId?: string): Promise<AgentSkill[]> {
      const rows = await prisma.agentSkill.findMany({
        where: scope(actor, botId),
        include: withBots,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map(mapAgentSkill);
    },

    async get(actor: Actor, input: { skillId?: string; name?: string }): Promise<AgentSkill> {
      if (input.skillId) {
        return mapAgentSkill(await owned(actor, input.skillId));
      }
      const name = input.name?.trim() ?? "";
      const rows = await prisma.agentSkill.findMany({
        where: {
          spaceId: actor.spaceId,
          userId: actor.userId,
        },
        include: withBots,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      const row = findSkillByName(rows, name);
      if (!row) throw new IsolationError();
      return mapAgentSkill(row);
    },

    async create(
      actor: Actor,
      input: {
        content?: string;
        name?: string;
        description?: string;
        body?: string;
        botId?: string;
      },
    ): Promise<AgentSkill> {
      const resolved = resolveSkillContent(input);
      const bot = input.botId ? await ownedBot(actor, input.botId) : null;
      const clash = await prisma.agentSkill.findFirst({
        where: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          name: { equals: resolved.name, mode: "insensitive" },
        },
      });
      if (clash) {
        throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
      }
      try {
        const row = await prisma.agentSkill.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            name: resolved.name,
            description: resolved.description,
            content: resolved.content,
            source: "user",
            ...(bot ? { bots: { create: { botId: bot.id } } } : {}),
          },
          include: withBots,
        });
        return mapAgentSkill(row);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
        }
        throw error;
      }
    },

    async update(
      actor: Actor,
      input: {
        skillId: string;
        content?: string;
        name?: string;
        description?: string;
        body?: string;
      },
    ): Promise<AgentSkill> {
      const existing = await owned(actor, input.skillId);
      if (isSkillReadOnly(asSource(existing.source) as SkillSource)) {
        throw new ORPCError("BAD_REQUEST", { message: "Plugin skills are read-only." });
      }
      const resolved = resolveSkillContent({ ...input, prior: existing });
      if (!findSkillByName([existing], resolved.name)) {
        const clash = await prisma.agentSkill.findFirst({
          where: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            name: { equals: resolved.name, mode: "insensitive" },
            NOT: { id: existing.id },
          },
        });
        if (clash) {
          throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
        }
      }
      // Mutate only owner-scoped user rows (never plugin), even if source was tampered.
      try {
        const updated = await prisma.agentSkill.updateMany({
          where: {
            id: existing.id,
            spaceId: actor.spaceId,
            userId: actor.userId,
            source: "user",
          },
          data: {
            name: resolved.name,
            description: resolved.description,
            content: resolved.content,
          },
        });
        if (updated.count !== 1) throw new IsolationError();
      } catch (error) {
        if (error instanceof IsolationError) throw error;
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
        }
        throw error;
      }
      return mapAgentSkill(await owned(actor, existing.id));
    },

    async remove(actor: Actor, skillId: string): Promise<{ ok: true }> {
      const existing = await owned(actor, skillId);
      if (isSkillReadOnly(asSource(existing.source) as SkillSource)) {
        throw new ORPCError("BAD_REQUEST", { message: "Plugin skills are read-only." });
      }
      const deleted = await prisma.agentSkill.deleteMany({
        where: {
          id: existing.id,
          spaceId: actor.spaceId,
          userId: actor.userId,
          source: "user",
        },
      });
      if (deleted.count !== 1) throw new IsolationError();
      return { ok: true };
    },

    async setAssigned(
      actor: Actor,
      input: { skillId: string; botId: string; assigned: boolean },
    ): Promise<Omit<AgentSkill, "content">> {
      const [skill, bot] = await Promise.all([
        owned(actor, input.skillId),
        ownedBot(actor, input.botId),
      ]);
      const key = { botId_skillId: { botId: bot.id, skillId: skill.id } };
      if (input.assigned) {
        await prisma.botSkill.upsert({
          where: key,
          create: { botId: bot.id, skillId: skill.id },
          update: {},
        });
      } else {
        await prisma.botSkill.deleteMany({ where: { botId: bot.id, skillId: skill.id } });
      }
      const { content: _content, ...entry } = mapAgentSkill(await owned(actor, skill.id));
      return entry;
    },
  };
}

export type AgentSkillsService = ReturnType<typeof createAgentSkillsService>;
