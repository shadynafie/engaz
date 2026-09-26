import type { AgentSkillCatalogEntry } from "@engaz/contracts";
import { expect, type Page, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  rpc,
  signup,
} from "./helpers";

test("the owner writes a skill for one agent and gives it to another", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `agent-skills-${stamp}@engaz.test`, "password12", "Skill Owner");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  const chiefId = activeBotId(page);

  // Skills sit in the agent's settings, next to its plugins.
  const skills = await openSkills(page, "Chief");
  await expect(skills.getByText("This agent has no skills yet.")).toBeVisible();
  await skills.getByRole("button", { name: "New skill", exact: true }).click();
  await skills.getByLabel("Name", { exact: true }).fill("Daily standup");
  await skills.getByLabel("When to use", { exact: true }).fill("When I ask for standup notes.");
  await skills
    .getByLabel("Instructions", { exact: true })
    .fill("1. Summarize wins.\n2. List blockers.");
  await captureScreenshot(page, testInfo, "agent-skill-editor");
  await skills.getByRole("button", { name: "Save", exact: true }).click();

  // A skill written from Chief's settings is Chief's.
  const chiefSwitch = skills.getByRole("switch", { name: "Daily standup" });
  await expect(chiefSwitch).toBeChecked();
  await captureScreenshot(page, testInfo, "agent-skills-list");
  await page.emulateMedia({ colorScheme: "dark" });
  await captureScreenshot(page, testInfo, "agent-skills-list-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectSlashSkill(page, true);

  // Another agent does not have it until the owner switches it on there.
  const writerId = await createNamedBot(page, "Writer");
  await expectSlashSkill(page, false);
  const writerSkills = await openSkills(page, "Writer");
  const writerSwitch = writerSkills.getByRole("switch", { name: "Daily standup" });
  await expect(writerSwitch).not.toBeChecked();
  const assigned = page.waitForResponse(
    (response) => response.url().includes("/rpc/agentSkills/setAssigned") && response.ok(),
  );
  await writerSwitch.click();
  await assigned;
  await expect(writerSwitch).toBeChecked();
  await expectSlashSkill(page, true);
  const [skill] = await rpc<AgentSkillCatalogEntry[]>(page, "agentSkills/list", {
    botId: writerId,
  });
  expect(skill?.botIds.sort()).toEqual([chiefId, writerId].sort());

  // The editor says who uses it, and SKILL.md stays one click away for power users.
  await writerSkills.getByRole("button", { name: /Daily standup/ }).click();
  await expect(writerSkills.getByText(/Used by (Chief, Writer|Writer, Chief)/)).toBeVisible();
  await writerSkills.getByRole("button", { name: "Edit SKILL.md", exact: true }).click();
  const raw = writerSkills.getByLabel("SKILL.md", { exact: true });
  await expect(raw).toHaveValue(/name: Daily standup/);
  await raw.fill((await raw.inputValue()).replace("List blockers.", "List risks."));
  await captureScreenshot(page, testInfo, "agent-skill-raw");
  await writerSkills.getByRole("button", { name: "Edit fields", exact: true }).click();
  await expect(writerSkills.getByLabel("Instructions", { exact: true })).toHaveValue(/List risks/);
  // Saving closes the editor before the refreshed assignment list arrives.
  // Keep that old snapshot in flight so it cannot overwrite a newer switch change.
  let refreshStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  let releaseRefresh!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/rpc/agentSkills/list", async (route) => {
    const response = await route.fetch();
    refreshStarted();
    await released;
    await route.fulfill({ response });
  });
  await writerSkills.getByRole("button", { name: "Save", exact: true }).click();
  await started;
  await expect(writerSwitch).toBeDisabled();
  // A click dispatched before the refresh settles must leave the assignment alone.
  await writerSwitch.dispatchEvent("click");
  await expect(writerSwitch).toBeChecked();
  await captureScreenshot(page, testInfo, "agent-skill-save-pending");
  releaseRefresh();
  await expect(writerSwitch).toBeEnabled();
  await page.unroute("**/rpc/agentSkills/list");

  // Switching it off takes it away from Writer only.
  await writerSwitch.click();
  await expect(writerSwitch).not.toBeChecked();
  await expectSlashSkill(page, false);
  expect(
    await rpc<AgentSkillCatalogEntry[]>(page, "agentSkills/list", { botId: writerId }),
  ).toEqual([]);

  // Deleting it removes it everywhere.
  await writerSkills.getByRole("button", { name: /Daily standup/ }).click();
  await writerSkills.getByRole("button", { name: "Delete", exact: true }).click();
  await writerSkills.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(writerSkills.getByText("This agent has no skills yet.")).toBeVisible();
  expect(await rpc<AgentSkillCatalogEntry[]>(page, "agentSkills/list", {})).toEqual([]);
});

async function openSkills(page: Page, agent: string) {
  await page
    .locator("main")
    .getByRole("button", { name: new RegExp(`^${agent}`) })
    .click();
  const skills = page.getByTestId("bot-settings").getByTestId("agent-skills");
  await expect(skills).toBeVisible();
  await skills.scrollIntoViewIfNeeded();
  return skills;
}

async function expectSlashSkill(page: Page, visible: boolean) {
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill("/");
  const option = page.getByRole("button", { name: "Skill Daily standup", exact: true });
  if (visible) await expect(option).toBeVisible();
  else {
    await expect(page.getByTestId("slash-picker")).toBeVisible();
    await expect(option).toHaveCount(0);
  }
  await composer.fill("");
}
