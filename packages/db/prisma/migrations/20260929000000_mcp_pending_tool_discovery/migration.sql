-- Existing explicit grants keep their permissions. Only new assignments await discovery.
ALTER TABLE "bot_mcp_servers" ADD COLUMN "pendingToolDiscovery" BOOLEAN NOT NULL DEFAULT false;
