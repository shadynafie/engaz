import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it } from "vitest";
import { mcpCheckFailure } from "./mcp-check.js";
import { McpReauthorizationRequiredError } from "./mcp-oauth.js";

describe("mcpCheckFailure", () => {
  it("treats a server waiting for sign-in as its own state", () => {
    expect(mcpCheckFailure(new McpReauthorizationRequiredError("server-1"))).toEqual({
      status: "sign_in",
      message: null,
      tools: [],
    });
    expect(mcpCheckFailure(new UnauthorizedError())).toMatchObject({ status: "sign_in" });
  });

  it("says what to do for the common failures", () => {
    const message = (error: string) => mcpCheckFailure(new Error(error)).message;
    expect(message("fetch failed")).toBe(
      "Couldn't reach the server. Check that it's running and the address is right.",
    );
    expect(message("MCP stdio command is not in the configured allowlist")).toBe(
      "This command isn't allowed. Add it to MCP_STDIO_ALLOWED_COMMANDS in .env.",
    );
    expect(message("Connector URL resolves to a private address")).toBe(
      "This address no longer points where it did when it was saved. Save the server again.",
    );
    expect(message("Streamable HTTP error: Error POSTing to endpoint (HTTP 401)")).toBe(
      "The server rejected the access token.",
    );
  });

  it("keeps a secret out of the message", () => {
    expect(
      mcpCheckFailure(new Error("bad token sk-live-secret-123"), ["sk-live-secret-123"]).message,
    ).not.toContain("sk-live-secret-123");
  });
});
