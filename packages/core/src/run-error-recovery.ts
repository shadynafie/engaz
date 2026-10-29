export type RunErrorRecovery = "connect-model" | "replace-key" | "choose-model";
export type RunErrorKind =
  | "missing-model"
  | "authentication"
  | "model"
  | "usage"
  | "temporary"
  | "unknown";

const TEMPORARY_ERROR =
  /rate.?limit|\b429\b|timed? ?out|timeout|overloaded|temporarily unavailable|\b50[234]\b|stream.{0,30}(?:ended|closed)|fetch failed|ECONN(?:RESET|REFUSED)|network error/i;

/** Match actionable model failures, leaving ambiguous tool/server errors without a model action. */
export function classifyRunError(error: string): {
  kind: RunErrorKind;
  recovery: RunErrorRecovery | null;
} {
  // Tool and computer failures can carry the same provider codes as model failures.
  if (
    /\b(?:MCP|sandbox|connector|plugin)\b|\btool (?:call|execution|request|error)\b|\bcomputer (?:provider|connection|start|request)\b/i.test(
      error,
    )
  ) {
    return { kind: TEMPORARY_ERROR.test(error) ? "temporary" : "unknown", recovery: null };
  }
  if (
    /^Connect a model (?:in Settings before running bots|to start a run)\.?$|^No model credential is connected/i.test(
      error.trim(),
    )
  ) {
    return { kind: "missing-model", recovery: "connect-model" };
  }
  // A quota message can mention a valid key; check usage before key rejection.
  if (
    /insufficient_quota|insufficient[_ ]credits|out of credits|credit balance|(?:quota|credits?|usage limit).*(?:exceeded|exhausted|reached)|(?:exceeded|exhausted).*(?:quota|credits?)|free.tier.*(?:limit|quota)/i.test(
      error,
    )
  ) {
    return { kind: "usage", recovery: "choose-model" };
  }
  if (
    /invalid_api_key|authentication_error|(?:invalid|incorrect|expired|revoked|missing|rejected)\s+(?:api[ _-]?key|model token)|api[ _-]?key.{0,30}(?:invalid|incorrect|expired|revoked|rejected)|model.{0,30}authentication failed/i.test(
      error,
    )
  ) {
    return { kind: "authentication", recovery: "replace-key" };
  }
  if (TEMPORARY_ERROR.test(error)) return { kind: "temporary", recovery: null };
  if (
    /model_not_found|model.{0,80}(?:not found|does not exist|not supported|unsupported|not available|unavailable|retired|cannot (?:read|process|support))|(?:does not support|unsupported).{0,30}(?:images?|vision|tools?|function calling)|(?:context window|request limit).{0,30}too small|(?:max_tokens|max_completion_tokens).{0,60}(?:too (?:small|low)|must be (?:at least|greater))/i.test(
      error,
    )
  ) {
    return { kind: "model", recovery: "choose-model" };
  }
  return { kind: "unknown", recovery: null };
}
