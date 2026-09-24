import type { McpCheckStatus } from "@engaz/contracts";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { sanitizeConnectorError } from "./connector-safety.js";
import { McpReauthorizationRequiredError } from "./mcp-oauth.js";

export type McpToolSummary = { name: string; description?: string };

export type McpCheckResult = {
  status: Exclude<McpCheckStatus, "unchecked">;
  message: string | null;
  tools: McpToolSummary[];
};

/** Longest tool description kept for the owner; servers sometimes send whole manuals. */
const MAX_TOOL_DESCRIPTION = 280;

export function summarizeMcpTools(
  tools: ReadonlyArray<{ name: string; description?: string }>,
): McpToolSummary[] {
  return tools.map(({ name, description }) => {
    const text = description
      ?.trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, " ");
    return text ? { name, description: text.slice(0, MAX_TOOL_DESCRIPTION) } : { name };
  });
}

/** Stored tools are names (older checks) or summaries; both read as summaries. */
export function storedMcpTools(value: unknown): McpToolSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): McpToolSummary[] => {
    if (typeof item === "string") return [{ name: item }];
    if (item && typeof item === "object" && typeof (item as McpToolSummary).name === "string") {
      const { name, description } = item as McpToolSummary;
      return [typeof description === "string" ? { name, description } : { name }];
    }
    return [];
  });
}

/** How long a check waits for a server to connect and list its tools. */
export const MCP_CHECK_TIMEOUT_MS = 20_000;

// Connection failures that never reached an MCP server.
const UNREACHABLE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|getaddrinfo|socket hang up|timed? ?out|aborted/i;

/**
 * What the owner reads when a server cannot be used. Sign-in is its own state: the
 * server is fine and waiting for the owner, not broken.
 */
export function mcpCheckFailure(error: unknown, secrets: string[] = []): McpCheckResult {
  if (error instanceof McpReauthorizationRequiredError || error instanceof UnauthorizedError) {
    return { status: "sign_in", message: null, tools: [] };
  }
  const detail = sanitizeConnectorError(error, secrets);
  return { status: "failing", message: failureMessage(detail), tools: [] };
}

function failureMessage(detail: string): string {
  if (/MCP stdio is disabled/i.test(detail)) {
    return "Local commands are turned off. Set MCP_STDIO_ENABLED=true in .env to allow them.";
  }
  if (/not in the configured allowlist/i.test(detail)) {
    return "This command isn't allowed. Add it to MCP_STDIO_ALLOWED_COMMANDS in .env.";
  }
  if (/private address/i.test(detail)) {
    return "This address no longer points where it did when it was saved. Save the server again.";
  }
  if (/must use HTTPS/i.test(detail)) return "Servers on the internet need an https:// address.";
  if (/\b401\b|unauthorized/i.test(detail)) return "The server rejected the access token.";
  if (/\b403\b|forbidden/i.test(detail)) return "The server refused access with these credentials.";
  if (UNREACHABLE.test(detail)) {
    return "Couldn't reach the server. Check that it's running and the address is right.";
  }
  return detail;
}
