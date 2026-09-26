import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

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
  await expect(page.locator("#selfhost")).toContainText("No clone or image build is needed. Run one command in a terminal:");
  await expect(page.locator("#selfhost li h3")).toHaveText(["Install", "Create the owner", "Meet your first agent"]);
  await expect(page.locator("#selfhost")).toContainText("Requires Docker Engine 26+");
  await expect(page.locator("#selfhost")).toContainText("Active development");
  await expect(page.locator("#how-it-works, #why-engaz")).toHaveCount(0);
  const installCommand = "curl -fsSL https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose/install-images.sh | bash";
  await expect(page.locator("[data-install-command]")).toHaveText([installCommand, installCommand]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await hero.getByRole("button", { name: "Copy command" }).click();
  await expect(hero.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(installCommand);
  await expect(hero.getByRole("button", { name: "Copy command" })).toBeVisible();
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

test("translated homepage keeps the same path", async ({ page }, testInfo) => {
  await page.goto("/zh/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI 队友。切实推进工作。");
  await expect(page.locator("main > section")).toHaveCount(4);
  await expect(page.locator(".stage-hero [data-install-command]")).toContainText("install-images.sh");
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

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("#team")).not.toHaveClass(/is-scroll-linked/);
  for (const teammate of await page.locator(".workbench-team__teammate").all()) {
    await expect(teammate).toHaveCSS("opacity", "1");
  }
});
