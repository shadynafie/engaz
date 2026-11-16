ALTER TABLE "connections" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "accountLabel" TEXT, ADD COLUMN "checkedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "connections_id_spaceId_userId_key" ON "connections"("id", "spaceId", "userId");
CREATE UNIQUE INDEX "bots_id_spaceId_userId_key" ON "bots"("id", "spaceId", "userId");
CREATE TABLE "bot_connections" (
  "connectionId" TEXT NOT NULL, "botId" TEXT NOT NULL, "spaceId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  CONSTRAINT "bot_connections_pkey" PRIMARY KEY ("connectionId", "botId"),
  CONSTRAINT "bot_connections_connectionId_spaceId_userId_fkey" FOREIGN KEY ("connectionId", "spaceId", "userId") REFERENCES "connections"("id", "spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_connections_botId_spaceId_userId_fkey" FOREIGN KEY ("botId", "spaceId", "userId") REFERENCES "bots"("id", "spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "bot_connections_botId_idx" ON "bot_connections"("botId");
-- Preserve existing legacy permissions; every newly connected account starts unassigned.
INSERT INTO "bot_connections" ("connectionId", "botId", "spaceId", "userId")
SELECT c.id, b.id, c."spaceId", c."userId" FROM "connections" c JOIN "bots" b ON b."spaceId" = c."spaceId" AND b."userId" = c."userId"
WHERE c."connectorId" IN ('composio', 'pipedream') AND c.status IN ('connected', 'pending', 'error');
