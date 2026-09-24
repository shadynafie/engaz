import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: screenshotPath,
  });
  await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
}

test("English homepage shows the current self-hosted product", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI teammates. Real progress.");
  await expect(page.locator("#team li")).toHaveCount(4);
  await expect(page.locator("#product img")).toBeVisible();
  await expect(page.locator("#how-it-works li")).toHaveCount(3);
  await expect(page.locator("#why-engaz")).toContainText("Apache-2.0");
  await expect(page.locator("main")).not.toContainText(/Grok Bot|Cloud waitlist|nothing phones home/i);

  const setup = page.locator(".workbench-hero").getByRole("link", { name: "Set up Engaz" });
  await expect(setup).toHaveAttribute("href", "#how-it-works");
  await expect(page.locator("#how-it-works [data-install-command]")).toHaveText(
    "curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash",
  );
  await expect(page.locator("#how-it-works").getByRole("button", { name: "Copy command" })).toBeVisible();
  await captureScreenshot(page, testInfo, "marketing-homepage-desktop");
});

test("Chinese homepage retains the same setup path", async ({ page }, testInfo) => {
  await page.goto("/zh/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI 队友。切实推进工作。");
  await expect(page.locator("#team li")).toHaveCount(4);
  await expect(page.locator("#how-it-works li")).toHaveCount(3);
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "设置 Engaz" }))
    .toHaveAttribute("href", "#how-it-works");
  await captureScreenshot(page, testInfo, "marketing-homepage-zh");
});
