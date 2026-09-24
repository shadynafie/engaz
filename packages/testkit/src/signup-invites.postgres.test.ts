import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@engaz/adapters";
import type { SignupInvite } from "@engaz/contracts";
import { SIGNUP_INVITE_HEADER } from "@engaz/core";
import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const fixtureOrigin = "http://127.0.0.1:7791";

describe.skipIf(!databaseAvailable)("invitation-only sign-up", () => {
  it("lets the owner claim the installation, then admits only people with a valid link", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "engaz-invites-"));
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
        signupsInviteOnly: "true",
        composio: new ComposioEmulator(),
        encryptionKey: "signup-invites-fixture-encryption-key",
      });
      stop = handles.stop;
      const { app, prisma } = handles;
      // This suite owns its database; start from "no owner yet" like a fresh install.
      await prisma.deploymentSettings.update({
        where: { id: "default" },
        data: { ownerUserId: null, signupsInviteOnly: true },
      });

      expect(await capabilities(app)).toMatchObject({ invitationRequired: false });
      const owner = await signup(app, email("owner"));
      expect(owner.status).toBe(200);
      const ownerCookie = sessionCookieHeader(owner);
      const me = await rpc<{ isDeploymentOwner: boolean }>(app, ownerCookie, "me");
      expect(me.isDeploymentOwner).toBe(true);
      expect(await capabilities(app)).toMatchObject({ invitationRequired: true });

      // Without a link, or with a made-up one, nobody else gets in.
      expect((await signup(app, email("stranger"))).status).toBe(403);
      expect((await signup(app, email("guesser"), "not-a-real-invite")).status).toBe(403);

      const { url, invite } = await rpc<{ url: string; invite: SignupInvite }>(
        app,
        ownerCookie,
        "invites/create",
      );
      const token = new URL(url).searchParams.get("invite")!;
      expect(new URL(url).pathname).toBe("/sign-up");
      // Only the hash is stored.
      const stored = await prisma.signupInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(stored.tokenHash).not.toContain(token);

      const invitedEmail = email("invited");
      const invited = await signup(app, invitedEmail, token);
      expect(invited.status).toBe(200);
      const invitedMe = await rpc<{ isDeploymentOwner: boolean }>(
        app,
        sessionCookieHeader(invited),
        "me",
      );
      expect(invitedMe.isDeploymentOwner).toBe(false);

      // One link, one person.
      expect((await signup(app, email("friend"), token)).status).toBe(403);
      const listed = await rpc<SignupInvite[]>(app, ownerCookie, "invites/list");
      expect(listed.find((row) => row.id === invite.id)).toMatchObject({
        usedByEmail: invitedEmail,
      });

      // Members cannot mint links; revoked and expired links stop working.
      const memberCreate = await raw(app, sessionCookieHeader(invited), "invites/create");
      expect(memberCreate.status).toBe(403);
      const revoked = await rpc<{ url: string; invite: SignupInvite }>(
        app,
        ownerCookie,
        "invites/create",
      );
      await rpc(app, ownerCookie, "invites/revoke", { id: revoked.invite.id });
      const revokedToken = new URL(revoked.url).searchParams.get("invite")!;
      expect((await signup(app, email("revoked"), revokedToken)).status).toBe(403);
      const expired = await rpc<{ url: string; invite: SignupInvite }>(
        app,
        ownerCookie,
        "invites/create",
      );
      await prisma.signupInvite.update({
        where: { id: expired.invite.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const expiredToken = new URL(expired.url).searchParams.get("invite")!;
      expect((await signup(app, email("late"), expiredToken)).status).toBe(403);
    } finally {
      await stop?.();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});

function email(label: string): string {
  return `${label}-${randomUUID()}@engaz.test`;
}

async function capabilities(app: App): Promise<{ invitationRequired: boolean }> {
  return (await app.request("/api/auth/capabilities")).json() as Promise<{
    invitationRequired: boolean;
  }>;
}

function signup(app: App, address: string, invite?: string): Promise<Response> {
  return app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: fixtureOrigin,
      ...(invite ? { [SIGNUP_INVITE_HEADER]: invite } : {}),
    },
    body: JSON.stringify({ email: address, password: "password12", name: "Invite test" }),
  });
}

function raw(app: App, cookie: string, procedure: string, input: unknown = {}) {
  return app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({ json: input }),
  });
}

async function rpc<T>(app: App, cookie: string, procedure: string, input: unknown = {}) {
  const response = await raw(app, cookie, procedure, input);
  const body = (await response.json()) as { json?: T & { message?: string } };
  if (response.status >= 400)
    throw new Error(`${procedure}: ${body.json?.message ?? response.status}`);
  return body.json as T;
}
