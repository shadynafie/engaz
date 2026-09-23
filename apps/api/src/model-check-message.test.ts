import { describe, expect, it } from "vitest";
import { modelCheckMessage } from "./model-check-message.js";

describe("modelCheckMessage", () => {
  const hosted = { name: "OpenRouter", modelId: "openai/gpt-test" };

  it("names the provider and what to do next", () => {
    expect(modelCheckMessage({ ok: false, reason: "auth" }, hosted, false)).toBe(
      "OpenRouter rejected this key. Check it and try again.",
    );
    expect(modelCheckMessage({ ok: false, reason: "model" }, hosted, false)).toBe(
      "OpenRouter can't use openai/gpt-test with this key. Choose another model.",
    );
    expect(modelCheckMessage({ ok: false, reason: "unreachable" }, hosted, false)).toBe(
      "Couldn't reach OpenRouter. Check this computer's internet connection.",
    );
  });

  it("shows the provider's own message when there is no clearer reason", () => {
    expect(
      modelCheckMessage(
        { ok: false, reason: "provider", detail: "500: overloaded" },
        hosted,
        false,
      ),
    ).toBe("OpenRouter returned an error: 500: overloaded");
  });

  it("points a containerized install from localhost to the host", () => {
    const server = {
      name: "The model server",
      modelId: "llama3.3",
      baseUrl: "http://localhost:11434/v1",
    };
    expect(modelCheckMessage({ ok: false, reason: "unreachable" }, server, true)).toBe(
      "Couldn't reach http://localhost:11434/v1. Engaz runs in Docker, so use host.docker.internal instead of localhost.",
    );
    expect(modelCheckMessage({ ok: false, reason: "unreachable" }, server, false)).toBe(
      "Couldn't reach http://localhost:11434/v1. Check the address and that the model server is running.",
    );
  });
});
