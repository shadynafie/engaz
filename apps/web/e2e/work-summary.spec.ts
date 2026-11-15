import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("work summary keeps action details collapsed and keyboard accessible", async ({
  page,
}, testInfo) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/fixtures/work-summary.html");
    const summary = page.getByTestId("work-summary");
    await expect(summary.locator("summary")).toHaveText("3 actions");
    await expect(summary.getByText("Read file", { exact: true })).toBeHidden();
    await summary.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(summary.getByText("Read file", { exact: true })).toBeVisible();
    await expect(summary.getByText("Search × 2", { exact: true })).toBeVisible();
    await expect(page.getByText("private argument", { exact: false })).toHaveCount(0);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
    await captureScreenshot(page, testInfo, `work-summary-expanded-${viewport.width}`);
    await page.keyboard.press("Enter");
    await captureScreenshot(page, testInfo, `work-summary-collapsed-${viewport.width}`);
  }
});

test("expanded summary opens recorded outcomes and approval decisions", async ({
  page,
}, testInfo) => {
  let requests = 0;
  await page.route("**/rpc/runs/details", async (route) => {
    requests += 1;
    await route.fulfill({
      json: {
        json: {
          runId: "run",
          taskId: "task",
          trigger: "user",
          originalTrigger: "user",
          originRunId: null,
          source: null,
          routine: null,
          authority: "Your account",
          effects: [
            {
              id: "success",
              tool: "Read file",
              outcome: "succeeded",
              reason: "Read completed.",
              decidedByYou: false,
              updatedAt: "2026-01-01T12:00:00Z",
            },
            {
              id: "refusal",
              tool: "Send message",
              outcome: "refused",
              reason: "You declined this action.",
              decidedByYou: true,
              updatedAt: "2026-01-01T12:00:01Z",
            },
          ],
          moreEffects: false,
        },
      },
    });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/fixtures/work-summary.html");
    const summary = page.getByTestId("work-summary");
    const before = requests;
    await expect(summary.getByRole("button", { name: "Details", exact: true })).toBeHidden();
    await summary.locator("summary").click();
    expect(requests).toBe(before);
    await summary.getByRole("button", { name: "Details", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Tool completed", { exact: true })).toBeVisible();
    await expect(dialog.getByText("refused", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Decision made by you.", { exact: false })).toBeVisible();
    await expect(dialog.getByText("Your account", { exact: true })).toBeVisible();
    await expect(page.getByText("private argument", { exact: false })).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        theme === "dark",
      );
      await captureScreenshot(page, testInfo, `work-summary-outcomes-${theme}-${width}`);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});
