import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("setup offers the app providers and saves only the selected one", async ({
  page,
}, testInfo) => {
  const saved: unknown[] = [];
  await page.route("**/rpc/integrationSetup/get", (route) =>
    route.fulfill({
      json: {
        json: {
          canConfigure: true,
          needsSetup: true,
          webUrl: "https://example.test/integrations/setup",
          providers: [
            { id: "composio", configured: false },
            { id: "pipedream", configured: false },
          ],
        },
      },
    }),
  );
  await page.route("**/rpc/integrationSetup/save", (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({ json: { json: { ok: true } } });
  });
  await signup(page, `integration-setup-${Date.now()}@engaz.test`, "password12", "Setup Test");
  // A new owner reaches their first agent before any integration setup.
  await completeOnboarding(page);
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
  await page.goto("/integrations/setup");
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeVisible();
  for (const name of ["Composio", "Pipedream"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // MCP servers have their own screen, so this page only sets up app providers.
  for (const name of ["Direct MCP", "Executor"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeHidden();
  }
  // Composio is chosen first, so its key field is ready.
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "integration-setup-options");
  await page.getByRole("button", { name: "Pipedream", exact: true }).click();
  await expect(page.getByLabel("Client ID", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Project ID", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Client secret", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "integration-setup-pipedream");
  await page.getByRole("button", { name: "Composio", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("fake-composio-key");
  await captureScreenshot(page, testInfo, "integration-setup-composio");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => saved)
    .toEqual([{ json: { provider: "composio", apiKey: "fake-composio-key" } }]);
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible({
    timeout: 20_000,
  });
});

test("remote members skip server setup and still add MCP servers", async ({ page }, testInfo) => {
  await page.route("**/rpc/integrationSetup/get", (route) =>
    route.fulfill({
      json: {
        json: {
          canConfigure: false,
          needsSetup: false,
          providers: [],
          webUrl: "https://example.test/integrations/setup",
        },
      },
    }),
  );
  await signup(page, `remote-member-${Date.now()}@engaz.test`, "password12", "Remote Member");
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Create your first bot" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "remote-member-onboarding");
  await completeOnboarding(page);
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  await captureScreenshot(page, testInfo, "remote-member-mcp");
  await page.getByRole("button", { name: "Close MCP servers" }).click();
  await page.goto("/integrations/setup");
  await page.waitForURL(/\/app/);
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
});

test("configured server owners manage providers from settings", async ({ page }, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { json: { ...body.json, me: { ...body.json.me, isDeploymentOwner: true } } },
    });
  });
  await page.route("**/rpc/integrationSetup/get", (route) =>
    route.fulfill({
      json: {
        json: {
          canConfigure: true,
          needsSetup: false,
          providers: [{ id: "composio", configured: true }],
          webUrl: "https://example.test/integrations/setup",
        },
      },
    }),
  );
  await signup(page, `configured-owner-${Date.now()}@engaz.test`, "password12", "Server Owner");
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
  await completeOnboarding(page);
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  const link = settings.getByRole("link", { name: "Server integrations", exact: true });
  await expect(link).toBeVisible();
  await captureScreenshot(page, testInfo, "server-integrations-settings");
  await link.click();
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeVisible();
  await page.getByRole("button", { name: "Composio", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "server-integrations-configured");
});
