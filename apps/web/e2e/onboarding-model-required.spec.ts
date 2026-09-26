import { expect, test } from "@playwright/test";
import { captureScreenshot, signup } from "./helpers";

test("onboarding requires a model when the deployment has none", async ({ page }, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        json: {
          ...body.json,
          needsModel: true,
          defaultProvider: "openrouter",
          defaultModel: "openai/gpt-5.6-luna",
        },
      },
    });
  });

  const stamp = Date.now();
  await signup(page, `model-required-${stamp}@engaz.test`, "password12", `Model required ${stamp}`);
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 20_000,
  });

  await expect(page.getByRole("button", { name: "Skip for now" })).toBeHidden();
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("API key", { exact: true }).fill("   ");
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("API key", { exact: true }).fill("fake-test-key");
  await expect(continueButton).toBeEnabled();
  await page.getByLabel("API key", { exact: true }).fill("");
  await captureScreenshot(page, testInfo, "onboarding-model-required");
});

test("onboarding stays on the model step and says why a key was rejected", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        json: {
          ...body.json,
          needsModel: true,
          defaultProvider: "openrouter",
          defaultModel: "openai/gpt-5.6-luna",
        },
      },
    });
  });
  // The API sends one test request with the key before saving it; this is its refusal.
  const message = "OpenRouter rejected this key. Check it and try again.";
  await page.route("**/rpc/models/connect", (route) =>
    route.fulfill({
      status: 400,
      json: {
        json: {
          defined: false,
          code: "BAD_REQUEST",
          status: 400,
          message,
          data: { reason: "auth" },
        },
      },
    }),
  );
  const stamp = Date.now();
  await signup(page, `model-rejected-${stamp}@engaz.test`, "password12", `Model rejected ${stamp}`);
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 20_000,
  });
  const apiKey = page.getByLabel("API key", { exact: true });
  await apiKey.fill("fake-rejected-key");
  await apiKey.press("Enter");
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "onboarding-model-rejected");

  await apiKey.fill("fake-corrected-key");
  await expect(page.getByText(message)).toHaveCount(0);
});

for (const unavailable of ["empty", "failed", "profile"] as const) {
  test(`onboarding recovers from ${unavailable} setup data without skipping the model`, async ({
    page,
  }, testInfo) => {
    let recovered = false;
    let botCreates = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/bots/create")) botCreates += 1;
    });
    await page.route("**/rpc/me", async (route) => {
      if (unavailable === "profile" && !recovered) {
        await route.abort();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as { json: Record<string, unknown> };
      await route.fulfill({ response, json: { json: { ...body.json, needsModel: true } } });
    });
    await page.route("**/rpc/models/list", (route) => {
      if (recovered || unavailable === "profile") return route.continue();
      return unavailable === "failed" ? route.abort() : route.fulfill({ json: { json: [] } });
    });
    const stamp = Date.now();
    await signup(page, `catalog-${unavailable}-${stamp}@engaz.test`, "password12", "Model setup");
    await expect(page.getByRole("alert")).toHaveText("Could not load setup");
    expect(botCreates).toBe(0);
    await expect(page.getByRole("heading", { name: "Create your first bot" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Message Chief" })).toHaveCount(0);
    await captureScreenshot(page, testInfo, `onboarding-${unavailable}-retry`);
    recovered = true;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
    await expect(page.getByLabel("Provider")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(botCreates).toBe(0);
  });
}
