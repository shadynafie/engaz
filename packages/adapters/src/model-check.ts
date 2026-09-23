import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ModelCheck, ModelCheckFailure } from "@engaz/adapter-kit";

/** Local servers may load a model on first use; hosted providers answer well inside this. */
export const MODEL_CHECK_TIMEOUT_MS = 60_000;

export const MODEL_CHECK_PROMPT = "Reply with OK.";

// Pi reports a rejected request only as text: "<status>: <body>", "<prefix> (<status>): <body>",
// or an SDK's "<status> <body>".
const STATUS_IN_MESSAGE = /^(?:[^(:]*\()?([1-5]\d\d)\b/;
// Failures that never reached a server: refused, unresolvable, or dropped connections.
const NETWORK_FAILURE =
  /connection error|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ETIMEDOUT|getaddrinfo|socket hang up/i;

/**
 * Reads a test completion. Any reply the provider finished, including one cut short by the
 * token limit, proves the key, model, and address work. Failures use the HTTP status when
 * there is one, so the reason does not depend on each vendor's error wording.
 */
export function modelCheckResult(
  reply: Pick<AssistantMessage, "stopReason" | "errorMessage">,
  timedOut: boolean,
): ModelCheck {
  if (reply.stopReason !== "error" && reply.stopReason !== "aborted") return { ok: true };
  const detail = reply.errorMessage?.trim() || undefined;
  const status = detail?.match(STATUS_IN_MESSAGE)?.[1];
  const reason = failureReason(
    status ? Number(status) : undefined,
    timedOut,
    detail ? NETWORK_FAILURE.test(detail) : true,
  );
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function failureReason(
  status: number | undefined,
  timedOut: boolean,
  networkFailure: boolean,
): ModelCheckFailure {
  if (timedOut) return "timeout";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model";
  if (status === 402) return "billing";
  if (status === 429) return "rate-limit";
  if (status === undefined && networkFailure) return "unreachable";
  return "provider";
}
