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

async function scrollTeamTo(page: Page, progress: number) {
  await page.locator("[data-team-journey]").evaluate((journey, ratio) => {
    const stage = journey.querySelector<HTMLElement>("[data-team-stage]");
    if (!stage) throw new Error("Team stage missing");
    const stickyTop = Number.parseFloat(getComputedStyle(stage).top) || 0;
    const start = window.scrollY + journey.getBoundingClientRect().top - stickyTop;
    window.scrollTo({ top: start + (journey.clientHeight - stage.clientHeight) * ratio, behavior: "instant" });
  }, progress);
  await expect.poll(async () =>
    page.locator("[data-team-stage]").evaluate((stage) => Number.parseFloat((stage as HTMLElement).style.getPropertyValue("--team-clip"))),
  ).toBeCloseTo((1 - progress) * 103 - 3, 0);
}

test("English homepage shows the current self-hosted product", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI teammates. Real progress.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://engaz.pages.dev/");
  const team = page.locator("#team");
  await expect(team.getByRole("heading", { level: 2 })).toHaveText("One teammate.Or a whole team.");
  for (const width of [1280, 1194, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const headingLines = await team.locator("h2 span").evaluateAll((spans) => spans.map((span) => ({
      height: span.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(span).lineHeight),
    })));
    for (const line of headingLines) expect(line.height).toBeLessThan(line.lineHeight * 1.1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(team.locator("[data-team-switch]")).toHaveCount(0);
  const product = page.locator("#product");
  await expect(product.getByRole("heading", { level: 2 })).toHaveText("See the work. Keep control.");
  await expect(product.locator(".workbench-product__agent h3")).toHaveText([
    "Chief", "Designer", "Engineer", "Accountant",
  ]);
  await expect(product.locator(".workbench-product__portrait img")).toHaveCount(4);
  await expect(product).toContainText("Illustrative agents · Define your own");
  await product.scrollIntoViewIfNeeded();
  await expect.poll(async () => product.locator(".workbench-product__portrait img").evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
  )).toBe(true);
  const firstRun = page.locator("#how-it-works");
  await expect(firstRun.getByRole("heading", { level: 2 })).toHaveText("Your team starts on your machine.");
  await expect(firstRun.locator("li h3")).toHaveText(["Install", "Create the owner", "Meet your first agent"]);
  await expect(firstRun).toContainText("Requires Docker Engine 26+");
  await expect(firstRun).toContainText("Active development");
  await expect(page.locator("#why-engaz")).toContainText("Apache-2.0");
  await expect(page.locator("main")).not.toContainText(/Grok Bot|Cloud waitlist|nothing phones home/i);

  const setup = page.locator(".workbench-hero").getByRole("link", { name: "Set up Engaz" });
  await expect(setup).toHaveAttribute("href", "#how-it-works");
  await expect(page.locator("#how-it-works [data-install-command]")).toHaveText(
    "curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash",
  );
  const copyCommand = firstRun.locator("[data-copy-install]");
  await expect(copyCommand).toHaveText("Copy command");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyCommand.click();
  await expect(copyCommand).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash",
  );
  await firstRun.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-first-run-viewport.png") });
  await scrollTeamTo(page, 0);
  await product.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-product-viewport.png") });
  await scrollTeamTo(page, 0);
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-team-solo.png") });
  await captureScreenshot(page, testInfo, "marketing-homepage-desktop");

  await scrollTeamTo(page, 0.5);
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-team-transition.png") });
  await scrollTeamTo(page, 1);
  await captureScreenshot(page, testInfo, "marketing-homepage-group");
  await scrollTeamTo(page, 0);
});

test("Chinese homepage retains the same setup path", async ({ page }, testInfo) => {
  await page.goto("/zh/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI 队友。切实推进工作。");
  await expect(page.locator("#team [data-team-switch]")).toHaveCount(0);
  await expect(page.locator("#how-it-works li")).toHaveCount(3);
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "设置 Engaz" }))
    .toHaveAttribute("href", "#how-it-works");
  await captureScreenshot(page, testInfo, "marketing-homepage-zh");
});

test("team view works on a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const team = page.locator("#team");
  const headingLines = await team.locator("h2 span").evaluateAll((spans) => spans.map((span) => ({
    height: span.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(span).lineHeight),
  })));
  expect(headingLines).toHaveLength(2);
  for (const line of headingLines) expect(line.height).toBeLessThan(line.lineHeight * 1.1);
  await scrollTeamTo(page, 0.5);
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-mobile-transition.png") });
  await scrollTeamTo(page, 1);
  await expect(team.locator(".workbench-team__panel--group img")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-mobile-group-viewport.png") });
  await page.locator("#product").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-mobile-product-viewport.png") });
  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("marketing-homepage-mobile-first-run-viewport.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await captureScreenshot(page, testInfo, "marketing-homepage-mobile-group");
});
