import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("bot avatar ring stays still when reduced motion is enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const avatar = page.getByTestId("light-Stock").locator(".engaz-bot-avatar");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("data-working", "true");

  const ring = avatar.locator(".engaz-bot-avatar-ring");
  await expect(ring).toBeVisible();
  const snapshot = () =>
    ring.evaluate((el: SVGElement) => ({
      animationName: getComputedStyle(el).animationName,
      transform: getComputedStyle(el).transform,
    }));
  const first = await snapshot();
  await page.waitForTimeout(300);
  const second = await snapshot();

  expect(first.animationName).toBe("none");
  expect(second).toEqual(first);
});

test("all avatar kinds share a centred comet with stock tint or theme colour", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/avatar-motion.html");
  for (const theme of ["light", "dark"]) {
    for (const [kind, color] of [
      ["Stock", "rgb(217, 80, 138)"],
      ["Shape", "rgb(59, 130, 246)"],
      ["Organic", "rgb(16, 185, 129)"],
      ["Uploaded", theme === "light" ? "rgb(26, 26, 26)" : "rgb(236, 236, 238)"],
    ]) {
      const avatar = page.getByTestId(`${theme}-${kind}`).locator(".engaz-bot-avatar");
      const ring = avatar.locator(".engaz-bot-avatar-ring");
      await expect(ring).toHaveCount(1);
      await expect(ring).toHaveCSS("color", color!);
      await expect(ring).toHaveCSS("animation-timing-function", "linear");
      await expect(ring.locator("path")).toHaveAttribute("d", "M24 2 A22 22 0 0 1 43.05 35");
      const offset = await avatar.evaluate((element) => {
        const body = element.getBoundingClientRect();
        const ring = element.querySelector(".engaz-bot-avatar-ring")!.getBoundingClientRect();
        return Math.hypot(
          body.x + body.width / 2 - ring.x - ring.width / 2,
          body.y + body.height / 2 - ring.y - ring.height / 2,
        );
      });
      expect(offset).toBeLessThan(0.1);
    }
  }
  await captureScreenshot(page, testInfo, "shared-avatar-comets-light-and-dark");
});
