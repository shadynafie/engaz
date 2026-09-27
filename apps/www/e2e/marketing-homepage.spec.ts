import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

// The Desktop Chrome device reports Windows; the install box follows the visitor's system.
test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.locator(".stage-hero img").evaluateAll((images) => Promise.all(images.map((image) => (image as HTMLImageElement).decode())));
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
  await expect(page.locator("[data-team-stage]")).toHaveAttribute("data-team-step", String(Math.min(3, Math.floor(progress * 4))));
}

test("homepage tells one product story and offers a working install command", async ({ page, context }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI teammates. Real progress.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://engaz.app/");
  await expect(page.locator("main > section")).toHaveCount(4);
  await expect(page.locator("#product h2")).toHaveText("See the work. Keep control.");
  await expect(page.locator("#product figcaption")).toHaveCount(0);
  await expect.poll(async () => page.locator("#product img").evaluate((image) =>
    (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
  )).toBe(true);
  await expect(page.locator("#team h2")).toHaveText("One teammate.Or a whole team.");
  await expect(page.locator("#team [data-team-stage]")).not.toHaveAttribute("aria-hidden", "true");
  const hero = page.locator(".stage-hero");
  await expect(hero.locator(".stage-hero__pill")).toHaveCount(0);
  for (const portrait of await hero.locator(".stage-hero__avatar img").all()) {
    await expect(portrait).toHaveAttribute("src", /-cutout\.webp$/);
    await expect.poll(() => portrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(hero.locator(".stage-hero__avatar").first()).toHaveCSS("overflow", "visible");
  await expect.poll(() => hero.locator("[data-hero-face]").evaluate((face) => {
    const command = face.parentElement?.querySelector("[data-install]");
    return Boolean(command && face.getBoundingClientRect().bottom <= command.getBoundingClientRect().top);
  })).toBe(true);
  await expect(hero).toContainText("solo founders and small businesses");
  await expect(page.locator("#selfhost h2")).toHaveText("Your AI team. Free to self-host.");
  await expect(page.locator("#selfhost")).toContainText("Run one command in a terminal. On Windows, use PowerShell.");
  await expect(page.locator("#selfhost li h3")).toHaveText(["Install", "Create the owner", "Meet your first agent"]);
  await expect(page.locator("#selfhost")).toContainText("It sets up Docker if needed");
  await expect(page.locator("#selfhost")).toContainText("Active development");
  await expect(page.locator("#how-it-works, #why-engaz")).toHaveCount(0);
  const installCommand = "curl -fsSL https://engaz.app/install.sh | bash";
  await expect(page.locator("[data-install-command]")).toHaveText([installCommand, installCommand]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await hero.getByRole("button", { name: "Copy command" }).click();
  await expect(hero.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(installCommand);
  await expect(hero.getByRole("button", { name: "Copy command" })).toBeVisible();
  const windowsCommand = "irm https://engaz.app/install.ps1 | iex";
  await hero.getByRole("button", { name: "Windows" }).click();
  await expect(page.locator("[data-install-command]")).toHaveText([windowsCommand, windowsCommand]);
  await expect(page.locator("#selfhost").getByRole("button", { name: "Windows" })).toHaveAttribute("aria-pressed", "true");
  await hero.getByRole("button", { name: "Copy command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(windowsCommand);
  await hero.getByRole("button", { name: "Linux" }).click();
  await expect(page.locator("[data-install-command]")).toHaveText([installCommand, installCommand]);
  await expect(hero.getByRole("button", { name: "Mac" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".site-header__cta").getByRole("link", { name: "View on GitHub" })).toHaveAttribute("href", "https://github.com/shadynafie/engaz");
  const setupLinks = page.getByRole("link", { name: "Installation guide" });
  await expect(setupLinks).toHaveCount(1);
  for (const link of await setupLinks.all()) {
    await expect(link).toHaveAttribute("href", /docs\/self-host/);
  }
  const teammates = page.locator(".workbench-team__teammate");
  await expect(teammates).toHaveCount(3);
  for (const [progress, count] of [[0, 0], [0.35, 1], [0.6, 2], [0.9, 3], [0.35, 1], [1, 3]]) {
    await scrollTeamTo(page, progress);
    for (let index = 0; index < 3; index += 1) {
      await expect(teammates.nth(index)).toHaveCSS("opacity", index < count ? "1" : "0");
    }
    if (count === 2) {
      const path = testInfo.outputPath("marketing-team-two-teammates.png");
      await page.locator("[data-team-stage]").screenshot({ animations: "disabled", path });
      await testInfo.attach("marketing-team-two-teammates", { contentType: "image/png", path });
    }
  }
  await captureScreenshot(page, testInfo, "marketing-homepage-desktop");
});

test.describe("on Windows", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });

  test("visitors start on the Windows command", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".stage-hero [data-install-command]")).toHaveText("irm https://engaz.app/install.ps1 | iex");
    await expect(page.locator(".stage-hero").getByRole("button", { name: "Windows" })).toHaveAttribute("aria-pressed", "true");
  });
});

test("narrow and reduced-motion views remain usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#team")).toHaveClass(/is-scroll-linked/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const teammates = page.locator(".workbench-team__teammate");
  for (const [progress, count] of [[0, 0], [0.35, 1], [0.6, 2], [0.9, 3], [0.35, 1]]) {
    await scrollTeamTo(page, progress);
    for (let index = 0; index < 3; index += 1) {
      await expect(teammates.nth(index)).toHaveCSS("opacity", index < count ? "1" : "0");
    }
  }
  const mobileTeamPath = testInfo.outputPath("marketing-team-mobile-one-teammate.png");
  await page.locator("[data-team-stage]").screenshot({ animations: "disabled", path: mobileTeamPath });
  await testInfo.attach("marketing-team-mobile-one-teammate", { contentType: "image/png", path: mobileTeamPath });
  await captureScreenshot(page, testInfo, "marketing-homepage-mobile");
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.locator("#team")).toHaveClass(/is-scroll-linked/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#team")).toHaveClass(/is-scroll-linked/);

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("#team")).not.toHaveClass(/is-scroll-linked/);
  for (const teammate of await page.locator(".workbench-team__teammate").all()) {
    await expect(teammate).toHaveCSS("opacity", "1");
  }
});
