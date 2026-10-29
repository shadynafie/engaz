import { describe, expect, it } from "vitest";
import { classifyRunError } from "./run-error-recovery.js";

describe("run error recovery", () => {
  it.each([
    "Connect a model in Settings before running bots.",
    "Connect a model to start a run.",
    "No model credential is connected for example-provider.",
  ])("offers model connections for %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "missing-model", recovery: "connect-model" });
  });
  it.each([
    "invalid_api_key",
    "Incorrect API key provided",
    "API key has been revoked",
    "authentication_error",
    "503: invalid_api_key",
  ])("offers replacing the key for %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "authentication", recovery: "replace-key" });
  });
  it.each([
    "insufficient_quota: check your API key's billing account",
    "Your credit balance is too low",
    "Free-tier daily limit reached",
    "429: insufficient_quota",
  ])("chooses a model instead of replacing a valid key for %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "usage", recovery: "choose-model" });
  });
  it.each([
    "model_not_found",
    "This model is retired",
    "This model is unsupported",
    "The model is not available to this account",
    "This model does not support images",
    "This model does not support tool use",
    "This model does not support function calling",
    "The model's context window is too small",
    "max_tokens must be at least 16",
  ])("offers another model for %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "model", recovery: "choose-model" });
  });
  it.each([
    "429 rate limit",
    "Request timed out",
    "Provider is overloaded",
    "stream ended",
    "ECONNRESET",
    "The model is temporarily unavailable",
    "503: The model is unavailable",
    "Sandbox provider is temporarily unavailable",
    "MCP server returned 503",
  ])("has no settings action for temporary failure %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "temporary", recovery: null });
  });
  it.each([
    "401 Unauthorized",
    "MCP server connection failed",
    "File does not exist",
    "Internal server error",
    "Provider is not configured: docker",
    "MCP server: invalid_api_key",
    "Connector: insufficient_quota",
    "Sandbox provider: invalid API key",
    "Tool error: model_not_found",
  ])("does not guess a model fix for %s", (error) => {
    expect(classifyRunError(error)).toEqual({ kind: "unknown", recovery: null });
  });
});
