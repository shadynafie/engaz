import { expect, type Locator, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openNewSpace, signup } from "./helpers";

function isPresented(error: Locator) {
  return error.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return topElement === element || (topElement !== null && element.contains(topElement));
  });
}

function seenRunErrorCount(page: Page) {
  return page.evaluate(() => {
    let count = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.startsWith("engaz:seen-run-error:")) count += 1;
    }
    return count;
  });
}

test("a failed run is visible once without returning after reload", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `run-failure-${stamp}@engaz.test`, "password12", "Run Failure");
  await completeOnboarding(page);

  // "fail this run" makes the scripted runtime throw, so the run fails the same way a
  // real provider error would, without depending on how models are configured.
  await page.getByPlaceholder(/^Message /).fill("fail this run");
  await page.getByRole("button", { name: "Send" }).click();

  const error = page.getByTestId("composer-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText("Scripted run failure");
  await captureScreenshot(page, testInfo, "new-run-error-visible");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByTestId("transcript").getByText("fail this run", { exact: true }),
  ).toBeVisible();
  await expect(error).toBeHidden();
  await captureScreenshot(page, testInfo, "seen-run-error-hidden-after-reload");

  await page.getByPlaceholder(/^Message /).fill("fail this run");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText("Scripted run failure");

  const dismissError = page.getByTestId("composer-error-dismiss");
  await dismissError.focus();
  await expect(dismissError).toBeFocused();
  await dismissError.press("Enter");
  await expect(error).toBeHidden();
  await expect(page.getByPlaceholder(/^Message /)).toBeFocused();
});

test("a covered run error is not remembered until it is presented", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `covered-run-failure-${stamp}@engaz.test`, "password12", "Covered Failure");
  await completeOnboarding(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByPlaceholder(/^Message /).fill("fail this run");
  const sendButton = await page.getByRole("button", { name: "Send" }).elementHandle();
  if (!sendButton) throw new Error("Send button not found");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
  await sendButton.evaluate((button) => (button as HTMLButtonElement).click());

  const error = page.getByTestId("composer-error");
  await expect(error).toContainText("Scripted run failure", { timeout: 30_000 });
  expect(await isPresented(error)).toBe(false);
  await captureScreenshot(page, testInfo, "run-error-covered-by-mobile-navigation");
  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeVisible();
  expect(await isPresented(error)).toBe(true);
  await captureScreenshot(page, testInfo, "covered-run-error-presented-after-reload");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeHidden();

  const recordedErrorCount = await seenRunErrorCount(page);
  await page.getByPlaceholder(/^Message /).fill("fail this run");
  const nextSendButton = await page.getByRole("button", { name: "Send" }).elementHandle();
  if (!nextSendButton) throw new Error("Send button not found");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await nextSendButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(error).toContainText("Scripted run failure", { timeout: 30_000 });

  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect.poll(() => isPresented(error)).toBe(true);
  await expect.poll(() => seenRunErrorCount(page)).toBe(recordedErrorCount + 1);
  await captureScreenshot(page, testInfo, "covered-run-error-presented-after-drawer-close");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator("main")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main")).toHaveJSProperty("inert", false);
  await page.getByPlaceholder(/^Message /).fill("fail this run");
  const modalSendButton = await page.getByRole("button", { name: "Send" }).elementHandle();
  if (!modalSendButton) throw new Error("Send button not found");
  await openNewSpace(page);
  const newSpaceDialog = page.getByRole("dialog", { name: "New space" });
  await expect(newSpaceDialog).toBeVisible();
  await modalSendButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(error).toContainText("Scripted run failure", { timeout: 30_000 });
  expect(await isPresented(error)).toBe(false);
  await expect.poll(() => seenRunErrorCount(page)).toBe(recordedErrorCount + 1);

  await newSpaceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(newSpaceDialog).toHaveCount(0);
  await expect.poll(() => isPresented(error)).toBe(true);
  await expect.poll(() => seenRunErrorCount(page)).toBe(recordedErrorCount + 2);
  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeHidden();
});

for (const scenario of [
  {
    name: "credit limit",
    width: 390,
    error: "Your credit balance is too low",
    action: "Choose a model",
    destination: "bot",
  },
  {
    name: "rejected key",
    width: 1280,
    error: "invalid_api_key",
    action: "Replace key",
    destination: "connections",
  },
] as const) {
  test(`a ${scenario.name} offers one working recovery action`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    const stamp = Date.now();
    await signup(page, `model-recovery-${stamp}@engaz.test`, "password12", "Model Recovery");
    await completeOnboarding(page);
    await page.getByPlaceholder(/^Message /).fill("fail this run");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("composer-error")).toBeVisible({ timeout: 30_000 });
    // Initial chat state comes from bootstrap; later syncs use threads/get.
    await page.route(/\/rpc\/(?:bootstrap|threads\/get)$/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const snapshot = route.request().url().endsWith("/bootstrap") ? body.json?.thread : body.json;
      if (snapshot?.run?.status === "failed") {
        snapshot.run = { ...snapshot.run, id: `recovery-${stamp}`, error: scenario.error };
      }
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    const error = page.getByTestId("composer-error");
    const recovery = error.getByTestId("run-error-recovery");
    await expect(recovery).toHaveCount(1);
    await expect(recovery).toHaveText(scenario.action);
    await expect(error.getByText(scenario.error, { exact: true })).toBeHidden();
    const overflow = await error.evaluate((notice) => notice.scrollWidth - notice.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await captureScreenshot(page, testInfo, `${scenario.destination}-model-error-recovery`);
    await error.getByText("Details", { exact: true }).click();
    await expect(error.getByText(scenario.error, { exact: true })).toBeVisible();
    await recovery.click();
    if (scenario.destination === "connections") {
      await expect(page.getByTestId("model-settings")).toBeVisible();
    } else {
      await expect(page.getByTestId("bot-settings-trigger")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(page.getByTestId("side-panel")).toHaveCSS("width", "384px");
    }
  });
}
