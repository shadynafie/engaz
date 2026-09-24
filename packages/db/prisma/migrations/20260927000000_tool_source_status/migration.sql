-- The last check or tool call that reached an OpenAPI, GraphQL, or MCP tool source, and
-- which agents may use it (NULL keeps today's behavior: every agent).
ALTER TABLE "capability_installs" ADD COLUMN "checkStatus" text NOT NULL DEFAULT 'unchecked';
ALTER TABLE "capability_installs" ADD COLUMN "checkMessage" text;
ALTER TABLE "capability_installs" ADD COLUMN "checkedAt" timestamp(3);
ALTER TABLE "capability_installs" ADD COLUMN "agentIds" jsonb;
