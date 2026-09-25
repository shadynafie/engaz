import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ComposioEmulator,
  listAgentSkillRecords,
  skillCreateFromTool,
  skillReadFromTool,
} from "@engaz/adapters";
import type { AgentSkill, AgentSkillCatalogEntry } from "@engaz/contracts";
import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const fixtureOrigin = "http://127.0.0.1:7791";

describe.skipIf(!databaseAvailable)("agent skill assignment", () => {
  it("gives a skill only to the agents it is assigned to", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "engaz-agent-skills-"));
    let stop: (() => Promise<void>) | undefined;
    try {
      const { createApp } = await import("../../../apps/api/src/app.ts");
      const handles = await createApp({
        databaseUrl: process.env.DATABASE_URL!,
        realtimeDatabaseUrl: process.env.DATABASE_URL!,
        authUrl: fixtureOrigin,
        webOrigin: fixtureOrigin,
        dataDir,
        sandboxProvider: "fake",
        agentRuntime: "scripted",
        wakeupDriver: "memory",
        signupsEnabled: "true",
        composio: new ComposioEmulator(),
        encryptionKey: "agent-skills-fixture-encryption-key",
      });
      stop = handles.stop;
      const { app, prisma } = handles;
      const cookie = await signup(app, "Skills owner");
      const writer = await createBot(app, cookie, "Writer");
      const analyst = await createBot(app, cookie, "Analyst");

      // A skill made from an agent's settings is given to that agent only.
      const standup = await rpc<AgentSkill>(app, cookie, "agentSkills/create", {
        name: "Daily standup",
        description: "Prepare standup notes",
        body: "1. Wins\n2. Blockers",
        botId: writer.id,
      });
      expect(standup.botIds).toEqual([writer.id]);
      expect(await names(app, cookie, writer.id)).toEqual(["Daily standup"]);
      expect(await names(app, cookie, analyst.id)).toEqual([]);

      // What a run receives follows the same assignment.
      const row = await prisma.bot.findUniqueOrThrow({ where: { id: writer.id } });
      const owner = { spaceId: row.spaceId, userId: row.userId };
      const forWriter = await listAgentSkillRecords(prisma, { ...owner, botId: writer.id });
      expect(forWriter.map((skill) => skill.name)).toEqual(["Daily standup"]);
      expect(await listAgentSkillRecords(prisma, { ...owner, botId: analyst.id })).toEqual([]);
      expect(
        await skillReadFromTool(prisma, { ...owner, botId: analyst.id }, { name: "Daily standup" }),
      ).toEqual({ error: "Skill not found." });

      // Switching it on for another agent takes effect on that agent's next run; off removes it.
      await rpc(app, cookie, "agentSkills/setAssigned", {
        skillId: standup.id,
        botId: analyst.id,
        assigned: true,
      });
      expect(await names(app, cookie, analyst.id)).toEqual(["Daily standup"]);
      expect(
        await skillReadFromTool(prisma, { ...owner, botId: analyst.id }, { name: "Daily standup" }),
      ).toMatchObject({ content: expect.stringContaining("Blockers") });
      await rpc(app, cookie, "agentSkills/setAssigned", {
        skillId: standup.id,
        botId: analyst.id,
        assigned: false,
      });
      expect(await listAgentSkillRecords(prisma, { ...owner, botId: analyst.id })).toEqual([]);

      // An edit reaches every agent that has the skill.
      await rpc(app, cookie, "agentSkills/update", { skillId: standup.id, body: "1. Risks" });
      const [edited] = await listAgentSkillRecords(prisma, { ...owner, botId: writer.id });
      expect(edited?.content).toContain("1. Risks");

      // A skill an agent writes for itself is given to that agent, and names stay unique.
      expect(
        await skillCreateFromTool(
          prisma,
          { ...owner, botId: analyst.id },
          {
            name: "Weekly report",
            description: "Summarize the week",
            body: "Totals first.",
          },
        ),
      ).toMatchObject({ ok: true });
      expect(await names(app, cookie, analyst.id)).toEqual(["Weekly report"]);
      expect(
        await skillCreateFromTool(
          prisma,
          { ...owner, botId: analyst.id },
          {
            name: "daily standup",
            description: "copy",
          },
        ),
      ).toEqual({ error: 'A skill named "Daily standup" already exists.' });

      // A duplicated agent keeps its skills.
      const copy = await rpc<{ id: string }>(app, cookie, "bots/duplicate", { botId: writer.id });
      expect(await names(app, cookie, copy.id)).toEqual(["Daily standup"]);

      // Nobody else can hand the owner's skill to an agent, or give theirs to the owner's agent.
      const member = await signup(app, "Skills member");
      const memberBot = await createBot(app, member, "Helper");
      await expect(
        rpc(app, member, "agentSkills/setAssigned", {
          skillId: standup.id,
          botId: memberBot.id,
          assigned: true,
        }),
      ).rejects.toThrow();
      const own = await rpc<AgentSkill>(app, member, "agentSkills/create", {
        name: "Mine",
        description: "Member skill",
      });
      await expect(
        rpc(app, member, "agentSkills/setAssigned", {
          skillId: own.id,
          botId: writer.id,
          assigned: true,
        }),
      ).rejects.toThrow();

      // Deleting a skill removes it from every agent.
      await rpc(app, cookie, "agentSkills/remove", { skillId: standup.id });
      expect(await names(app, cookie, writer.id)).toEqual([]);
      expect(await prisma.botSkill.count({ where: { skillId: standup.id } })).toBe(0);
    } finally {
      await stop?.();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});

async function names(app: App, cookie: string, botId: string): Promise<string[]> {
  const skills = await rpc<AgentSkillCatalogEntry[]>(app, cookie, "agentSkills/list", { botId });
  return skills.map((skill) => skill.name);
}

function createBot(app: App, cookie: string, name: string): Promise<{ id: string }> {
  return rpc(app, cookie, "bots/create", {
    name,
    title: name,
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });
}

async function signup(app: App, name: string): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({
      email: `agent-skills-${randomUUID()}@engaz.test`,
      password: "password12",
      name,
    }),
  });
  return sessionCookieHeader(response);
}

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json?: T & { message?: string } };
  if (response.status >= 400)
    throw new Error(`${procedure}: ${body.json?.message ?? response.status}`);
  return body.json as T;
}
