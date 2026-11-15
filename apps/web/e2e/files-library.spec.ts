import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("files can be found, previewed and downloaded after reopening chat", async ({
  page,
}, testInfo) => {
  await signup(page, `files-${Date.now()}@engaz.test`, "password12", "Files owner");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "artifacts/create", {
    botId,
    name: "weekly-report.md",
    mimeType: "text/markdown",
    contentBase64: Buffer.from("# Weekly report\n\nAll checks complete.").toString("base64"),
  });
  await rpc(page, "artifacts/create", {
    botId,
    name: "notes.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from("Other notes").toString("base64"),
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.locator("main").getByRole("button", { name: "Files", exact: true }).first().click();
    const library = page.getByTestId("file-library");
    await expect(
      library.getByRole("button", { name: "weekly-report.md", exact: true }),
    ).toBeVisible();
    await library.getByLabel("Search files").fill("weekly");
    await expect(library.getByRole("button", { name: "notes.txt", exact: true })).toHaveCount(0);
    await library.getByRole("button", { name: "weekly-report.md", exact: true }).click();
    await expect(library.getByText("All checks complete.", { exact: false })).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        theme === "dark",
      );
      await captureScreenshot(page, testInfo, `file-library-${theme}-${width}`);
    }
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    const downloaded = page.waitForEvent("download");
    await library.getByRole("button", { name: "Download weekly-report.md", exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe("weekly-report.md");
    await page.keyboard.press("Escape");
    await expect(library).toHaveCount(0);
  }
});
