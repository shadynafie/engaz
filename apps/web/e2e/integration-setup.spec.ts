import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("legacy integration setup opens Settings Connections", async ({ page }, testInfo) => {
  await signup(page, `connections-legacy-${Date.now()}@engaz.test`, "password12", "Legacy route");
  await completeOnboarding(page);
  await page.goto("/integrations/setup");
  const settings = page.getByTestId("user-settings");
  await expect(settings).toHaveAttribute("data-settings-section", "connections");
  await expect(settings.getByTestId("connections-settings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Server integrations" })).toHaveCount(0);
  await expect(page.getByLabel("Client secret", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "legacy-connections-settings");
});
