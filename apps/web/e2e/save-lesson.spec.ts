import type { AgentSkillCatalogEntry, RunsListOutput } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("a completed reply becomes a reviewed lesson only after explicit save", async ({
  page,
}, testInfo) => {
  await signup(page, `lesson-${Date.now()}@engaz.test`, "password12", "Lesson Owner");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Day-to-day work/ }).click();
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill("Prepare an evidence-led report.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => {
      const { runs } = await rpc<RunsListOutput>(page, "runs/list", { filter: "recent" });
      return runs.some((run) => run.botId === botId && run.status === "completed");
    })
    .toBe(true);
  const reply = page
    .getByTestId("transcript")
    .locator("[data-message-id]")
    .filter({ hasText: /done\. i handled: Prepare an evidence-led report\./ })
    .first();
  await expect(reply).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await reply.hover();
  await reply.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save a lesson", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save a lesson" });
  await expect(dialog.getByRole("button", { name: "Generate draft" })).toBeEnabled();
  await dialog.getByText("Source evidence", { exact: true }).click();
  await expect(
    dialog.getByText(/done\. i handled: Prepare an evidence-led report\./),
  ).toBeVisible();
  await dialog.getByLabel("Corrections (optional)").fill("Keep uncertainty visible.");
  await captureScreenshot(page, testInfo, "lesson-source-review");
  await dialog.getByRole("button", { name: "Generate draft" }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("evidence-led-report");
  expect(await rpc<AgentSkillCatalogEntry[]>(page, "agentSkills/list", {})).toEqual([]);
  await dialog
    .getByLabel("Instructions", { exact: true })
    .fill("Cite the source evidence. Keep uncertainty visible.");
  await captureScreenshot(page, testInfo, "lesson-draft-review");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await captureScreenshot(page, testInfo, "lesson-draft-review-narrow-dark");
  await dialog.getByRole("button", { name: "Save and assign" }).click();
  await expect(dialog).toHaveCount(0);
  const skills = await rpc<AgentSkillCatalogEntry[]>(page, "agentSkills/list", { botId });
  expect(skills).toHaveLength(1);
  expect(skills[0]).toMatchObject({ name: "evidence-led-report", botIds: [botId] });
});
