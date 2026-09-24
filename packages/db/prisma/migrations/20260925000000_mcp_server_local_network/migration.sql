-- Servers the owner saved as being on their own machine or network. They may use
-- plain HTTP and are dialed only at local addresses.
ALTER TABLE "mcp_servers" ADD COLUMN "localNetwork" boolean NOT NULL DEFAULT false;

-- Plain-HTTP localhost servers already worked before this column; keep them working.
UPDATE "mcp_servers"
SET "localNetwork" = true
WHERE "endpoint" ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)';
