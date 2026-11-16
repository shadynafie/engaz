import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("focus choice keeps the agent name and omits apps without publisher setup", async ({
  page,
}, testInfo) => {
  await signup(page, `onboarding-${Date.now()}@engaz.test`, "password12", "Robin");
  await completeOnboarding(page);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Day-to-day work/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Research & writing/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /A bit of everything/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "choice-card-onboarding");

  await page.getByRole("button", { name: /Day-to-day work/ }).click();
  await expect(page.locator("main").getByText("Chief", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Message Chief")).toBeVisible();
  await expect(
    page
      .getByTestId("transcript")
      .getByText("What would you like to work on first?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: / connection$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect for this agent" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "focus-without-configured-apps");

  await page.reload();
  await expect(
    page
      .getByTestId("transcript")
      .getByText("What would you like to work on first?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: / connection$/ })).toHaveCount(0);
});

test("focus choice follows Simplified Chinese UI locale", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `onboarding-zh-cn-${stamp}@engaz.test`, "password12", "Robin");
  await completeOnboarding(page);

  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();

  const settings = await openUserSettings(page);
  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await settings.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "语言", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "关闭用户设置" }).click();
  await expect(settings).toHaveCount(0);

  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("你想让我先做什么？", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /日常工作/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱和邮件/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /调研和写作/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /什么都做一点/ })).toBeVisible();
  await page.mouse.move(1, 1);
  await captureScreenshot(page, testInfo, "choice-card-onboarding-zh-cn");
});

test("choice refresh failures leave options available for retry", async ({ page }) => {
  await signup(page, `choice-refresh-${Date.now()}@engaz.test`, "password12", "Choice Retry");
  await completeOnboarding(page);
  const choice = page.getByRole("button", { name: /Day-to-day work/ });
  await expect(choice).toBeEnabled();
  // Keep the existing choice rendered while its save succeeds and navigation refresh fails.
  await page.route("**/rpc/onboarding/choose", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ json: { ok: true } }),
    }),
  );
  await page.route("**/rpc/spaces/list", (route) => route.abort());
  await Promise.all([page.waitForRequest("**/rpc/spaces/list"), choice.click()]);
  await expect(choice).toBeEnabled();
});
