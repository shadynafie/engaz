import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@engaz/adapters";
import type { MemoryDocument } from "@engaz/contracts";
import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

describe.skipIf(process.env.VERIFY_DATABASE !== "1")("forgetting memory", () => {
  it("checks ownership and revision, deletes document history and stays forgotten on reload", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "engaz-memory-forget-"));
    const { createApp } = await import("../../../apps/api/src/app.ts");
    const handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      realtimeDatabaseUrl: process.env.DATABASE_URL!,
      dataDir,
      authUrl: "http://127.0.0.1:7791",
      webOrigin: "http://127.0.0.1:7791",
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioEmulator(),
      encryptionKey: "memory-forget-fixture-encryption-key",
    });
    const app = handles.app;
    async function request(cookie: string, procedure: string, json: unknown) {
      return app.request(`/rpc/${procedure}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:7791", cookie },
        body: JSON.stringify({ json }),
      });
    }
    async function rpc<T>(cookie: string, procedure: string, json: unknown): Promise<T> {
      const res = await request(cookie, procedure, json);
      expect(res.ok).toBe(true);
      return ((await res.json()) as { json: T }).json;
    }
    async function signup() {
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:7791" },
        body: JSON.stringify({
          email: `forget-${randomUUID()}@engaz.test`,
          password: "test-password-123",
          name: "Memory owner",
        }),
      });
      expect(res.ok).toBe(true);
      return sessionCookieHeader(res);
    }
    try {
      const owner = await signup();
      const other = await signup();
      const [doc] = await rpc<MemoryDocument[]>(owner, "memory/list", { scope: "user" });
      expect(doc).toBeDefined();
      const updated = await rpc<MemoryDocument>(owner, "memory/update", {
        documentId: doc.id,
        content: "A fictional preference to forget",
      });
      expect(
        await handles.prisma.memoryRevision.count({ where: { documentId: doc.id } }),
      ).toBeGreaterThan(0);
      expect(
        (await request(other, "memory/remove", { documentId: doc.id, revision: updated.revision }))
          .status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (await request(owner, "memory/remove", { documentId: doc.id, revision: doc.revision }))
          .status,
      ).toBe(409);
      expect(await handles.prisma.memoryDocument.count({ where: { id: doc.id } })).toBe(1);
      await rpc(owner, "memory/remove", { documentId: doc.id, revision: updated.revision });
      expect(await handles.prisma.memoryRevision.count({ where: { documentId: doc.id } })).toBe(0);
      expect(await handles.prisma.memoryDocument.count({ where: { id: doc.id } })).toBe(0);
      expect(
        await rpc<MemoryDocument[]>(owner, "memory/list", { scope: "user" }),
      ).not.toContainEqual(expect.objectContaining({ id: doc.id }));
    } finally {
      await handles.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
