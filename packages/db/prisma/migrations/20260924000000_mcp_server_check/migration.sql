-- The result of the last connection check: whether agents can reach the server now,
-- why not, and which tools it offered when it last worked.
ALTER TABLE "mcp_servers" ADD COLUMN "checkStatus" text NOT NULL DEFAULT 'unchecked';
ALTER TABLE "mcp_servers" ADD COLUMN "checkMessage" text;
ALTER TABLE "mcp_servers" ADD COLUMN "checkedAt" timestamp(3);
ALTER TABLE "mcp_servers" ADD COLUMN "tools" jsonb NOT NULL DEFAULT '[]';
