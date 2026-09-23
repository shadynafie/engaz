import { existsSync } from "node:fs";
import type { ModelCheck } from "@engaz/adapter-kit";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Docker creates this file in every container. */
export function runningInContainer(): boolean {
  return existsSync("/.dockerenv");
}

/**
 * What the owner reads when a test request fails, before anything is saved. `name` is the
 * provider's display name; `baseUrl` is set for a custom model server.
 */
export function modelCheckMessage(
  check: Extract<ModelCheck, { ok: false }>,
  connection: { name: string; modelId: string; baseUrl?: string },
  inContainer = runningInContainer(),
): string {
  const { name, modelId, baseUrl } = connection;
  switch (check.reason) {
    case "auth":
      return `${name} rejected this key. Check it and try again.`;
    case "model":
      return `${name} can't use ${modelId} with this key. Choose another model.`;
    case "billing":
      return `${name} accepted the key, but the account needs credit first.`;
    case "rate-limit":
      return `${name} is limiting requests for this key. Wait a moment and try again.`;
    case "timeout":
      return `${name} didn't answer within a minute. Try again.`;
    case "unreachable":
      if (!baseUrl) return `Couldn't reach ${name}. Check this computer's internet connection.`;
      // Inside the container, localhost is Engaz itself, not the computer running the model.
      if (inContainer && LOOPBACK_HOSTS.has(new URL(baseUrl).hostname)) {
        return `Couldn't reach ${baseUrl}. Engaz runs in Docker, so use host.docker.internal instead of ${new URL(baseUrl).hostname}.`;
      }
      return `Couldn't reach ${baseUrl}. Check the address and that the model server is running.`;
    case "provider":
      return check.detail
        ? `${name} returned an error: ${check.detail}`
        : `${name} returned an error. Try again.`;
  }
}
