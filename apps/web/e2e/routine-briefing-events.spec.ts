import type { Routine } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("quiet briefings persist and event-only routines connect without a dummy schedule", async ({
  page,
}, testInfo) => {
  await signup(page, `briefing-${Date.now()}@engaz.test`, "password12", "Briefing owner");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const connection = await rpc<{ connectionId: string }>(page, "connections/begin", {
    provider: "GMAIL",
    displayName: "Mail",
    connectorId: "composio",
  });
  const routine = await rpc<Routine>(page, "routines/create", {
    botId,
    name: "Chief briefing",
    prompt: "Brief me on new work needing attention",
    crons: ["0 9 * * *"],
    active: true,
  });
  await page.reload();
  await page.getByTitle("Agent computer").click();
  await page.getByRole("button", { name: /Chief briefing/ }).click();
  await page.getByRole("checkbox", { name: "Only brief me on new work needing attention" }).check();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/update") && response.ok(),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  expect((await rpc<Routine[]>(page, "routines/list", { botId }))[0]?.quietBriefing).toBe(true);
  await captureScreenshot(page, testInfo, "quiet-briefing-desktop");
  await page.reload();
  await page.getByTitle("Agent computer").click();
  await page.getByRole("button", { name: /Chief briefing/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Only brief me on new work needing attention" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.getByPlaceholder("Name this routine").fill("Mail triage");
  await page
    .getByPlaceholder("What should this routine do each time it runs?")
    .fill("Review a new mail item");
  await page.getByRole("button", { name: "Connect app event" }).click();
  await page.getByLabel("App", { exact: true }).selectOption(connection.connectionId);
  await expect(page.getByLabel("Event", { exact: true })).toBeEnabled();
  await page.getByLabel("Event", { exact: true }).selectOption("NEW_ITEM");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove app event" })).toBeVisible();
  const eventRoutine = (await rpc<Routine[]>(page, "routines/list", { botId })).find(
    (item) => item.name === "Mail triage",
  )!;
  expect(eventRoutine).toMatchObject({
    crons: [],
    active: true,
    appEvent: { connectionId: connection.connectionId, event: "NEW_ITEM" },
  });
  await captureScreenshot(page, testInfo, "app-event-routine-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await captureScreenshot(page, testInfo, "app-event-routine-mobile-width");
  await page.getByRole("button", { name: "Remove app event" }).click();
  await expect(page.getByRole("button", { name: "Connect app event" })).toBeVisible();
  expect(
    (await rpc<Routine[]>(page, "routines/list", { botId })).find(
      (item) => item.id === eventRoutine.id,
    ),
  ).toMatchObject({ active: false, appEvent: null });
  await rpc(page, "routines/remove", { routineId: routine.id });
  await rpc(page, "routines/remove", { routineId: eventRoutine.id });
});
