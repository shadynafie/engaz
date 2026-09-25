import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true, path: screenshotPath });
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
    page.locator("[data-team-stage]").evaluate((stage) =>
      Number.parseFloat((stage as HTMLElement).style.getPropertyValue("--team-clip")),
    ),
  ).toBeCloseTo((1 - progress) * 103 - 3, 0);
}

test("homepage tells one product story and offers a working install command", async ({ page, context }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI teammates. Real progress.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://engaz.pages.dev/");
  await expect(page.locator("main > section")).toHaveCount(4);
  await expect(page.locator("#product h2")).toHaveText("See the work. Keep control.");
  await expect(page.locator("#product figcaption")).toContainText("Isolated scripted test run");
  await expect.poll(async () => page.locator("#product img").evaluate((image) =>
    (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
  )).toBe(true);
  await expect(page.locator("#team h2")).toHaveText("One teammate.Or a whole team.");
  await expect(page.locator("#team [data-team-stage]")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".workbench-hero")).toContainText("Free & open source");
  await expect(page.locator(".workbench-hero")).toContainText("solo founders and small businesses");
  await expect(page.locator("#selfhost h2")).toHaveText("Your AI team. Free to self-host.");
  await expect(page.locator("#selfhost")).toContainText("No clone or image build is needed. Run one command in a terminal:");
  await expect(page.locator("#selfhost li h3")).toHaveText(["Install", "Create the owner", "Meet your first agent"]);
  await expect(page.locator("#selfhost")).toContainText("Requires Docker Engine 26+");
  await expect(page.locator("#selfhost")).toContainText("Active development");
  await expect(page.locator("#how-it-works, #why-engaz")).toHaveCount(0);
  const installCommand = "curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash";
  await expect(page.locator("[data-install-command]")).toHaveText(installCommand);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(installCommand);
  await expect(page.getByRole("button", { name: "Copy command" })).toBeVisible();
  await expect(page.locator(".site-header").getByRole("link", { name: "Install Engaz" })).toHaveAttribute("href", "/#selfhost");
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "Install Engaz" })).toHaveAttribute("href", "#selfhost");
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "See the workspace" })).toHaveAttribute("href", "#product");
  const setupLinks = page.getByRole("link", { name: "Installation guide" });
  await expect(setupLinks).toHaveCount(1);
  for (const link of await setupLinks.all()) {
    await expect(link).toHaveAttribute("href", /docs\/self-host/);
  }
  await scrollTeamTo(page, 1);
  await captureScreenshot(page, testInfo, "marketing-homepage-desktop");
});

test("translated homepage keeps the same path", async ({ page }, testInfo) => {
  await page.goto("/zh/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI 队友。切实推进工作。");
  await expect(page.locator("main > section")).toHaveCount(4);
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "安装 Engaz" })).toHaveAttribute("href", "#selfhost");
  await expect(page.locator(".workbench-hero").getByRole("link", { name: "查看工作空间" })).toHaveAttribute("href", "#product");
  await expect(page.locator("#selfhost")).toContainText("无需克隆仓库或构建镜像");
  await expect(page.locator("#selfhost li")).toHaveCount(3);
  await captureScreenshot(page, testInfo, "marketing-homepage-zh");
});

test("narrow and reduced-motion views remain usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#team")).not.toHaveClass(/is-scroll-linked/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await captureScreenshot(page, testInfo, "marketing-homepage-mobile");
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.locator("#team")).toHaveClass(/is-scroll-linked/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#team")).not.toHaveClass(/is-scroll-linked/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("#team")).not.toHaveClass(/is-scroll-linked/);
  await expect(page.getByText("One shared thread. Distinct agents working together.")).toBeAttached();
});
