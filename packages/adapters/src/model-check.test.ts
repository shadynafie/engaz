import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { modelCheckResult } from "./model-check.js";
import { PiAgentRuntime } from "./pi-runtime.js";

describe("modelCheckResult", () => {
  it("accepts any reply the provider finished, including a truncated one", () => {
    expect(modelCheckResult({ stopReason: "stop" }, false)).toEqual({ ok: true });
    expect(modelCheckResult({ stopReason: "length" }, false)).toEqual({ ok: true });
  });

  it("reads the reason from the HTTP status, not the provider's wording", () => {
    const failure = (errorMessage: string) =>
      modelCheckResult({ stopReason: "error", errorMessage }, false);
    expect(failure('401: {"message":"bad key"}')).toMatchObject({ ok: false, reason: "auth" });
    expect(failure("Bedrock (403): denied")).toMatchObject({ reason: "auth" });
    expect(failure('404 {"type":"error"}')).toMatchObject({ reason: "model" });
    expect(failure("402: add credit")).toMatchObject({ reason: "billing" });
    expect(failure("429: slow down")).toMatchObject({ reason: "rate-limit" });
    expect(failure("500: upstream failed")).toMatchObject({
      reason: "provider",
      detail: "500: upstream failed",
    });
  });

  it("calls a failure unreachable only when no server answered", () => {
    const failure = (errorMessage: string) =>
      modelCheckResult({ stopReason: "error", errorMessage }, false);
    expect(failure("Connection error.")).toMatchObject({ reason: "unreachable" });
    expect(failure("getaddrinfo ENOTFOUND models.example.test")).toMatchObject({
      reason: "unreachable",
    });
    expect(failure("The model does not support this request")).toMatchObject({
      reason: "provider",
    });
    expect(modelCheckResult({ stopReason: "aborted" }, true)).toMatchObject({
      reason: "timeout",
    });
  });
});

describe("PiAgentRuntime.verifyModel", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function modelServer(status: number): Promise<string> {
    const listening = createServer((request, response) => {
      request.resume();
      if (status !== 200) {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `status ${status}` } }));
        return;
      }
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "check",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-model",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `${chunk({ role: "assistant", content: "OK" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
      );
    });
    server = listening;
    await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(listening.address() as AddressInfo).port}/v1`;
  }

  function check(baseUrl: string) {
    return new PiAgentRuntime().verifyModel(
      { provider: "openai-compatible", id: "test-model", baseUrl, apiKey: "local-test-key" },
      new AbortController().signal,
    );
  }

  it("passes when the model server answers", async () => {
    await expect(check(await modelServer(200))).resolves.toEqual({ ok: true });
  });

  it("reports a rejected key", async () => {
    await expect(check(await modelServer(401))).resolves.toMatchObject({
      ok: false,
      reason: "auth",
    });
  });

  it("reports a server that is not running", async () => {
    const baseUrl = await modelServer(200);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    await expect(check(baseUrl)).resolves.toMatchObject({ ok: false, reason: "unreachable" });
  });
});
