import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const scenarios = [
  "failure",
  "conversation",
  "working",
  "questions",
  "approval",
  "secret",
  "delegation",
  "cards",
  "long",
];

test("chat gallery renders real components without an API across themes and widths", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const apiReads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^\/(?:rpc|api)\//.test(new URL(request.url()).pathname)) apiReads.push(request.url());
  });
  for (const scenario of scenarios) {
    for (const theme of ["light", "dark"]) {
      for (const width of ["desktop", "phone"]) {
        await page.setViewportSize({ width: width === "phone" ? 390 : 1280, height: 900 });
        await page.goto(
          `/e2e/fixtures/gallery.html?scenario=${scenario}&theme=${theme}&width=${width}`,
        );
        await expect(page.getByRole("combobox", { name: "Scenario", exact: true })).toHaveValue(
          scenario,
        );
        await expect(page.getByTestId("transcript")).toBeVisible();
        await expect(page.getByTestId("composer-bar")).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        await captureScreenshot(page, testInfo, `gallery-${scenario}-${theme}-${width}`);
      }
    }
  }
  expect(errors).toEqual([]);
  expect(apiReads).toEqual([]);
});

test("gallery working controls preserve a draft when stopped", async ({ page }) => {
  await page.goto("/e2e/fixtures/gallery.html?scenario=working&theme=light&width=phone");
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await composer.fill("Keep this unsent.");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(composer).toHaveValue("Keep this unsent.");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
});
