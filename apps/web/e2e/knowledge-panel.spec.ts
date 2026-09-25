import { readFile } from "node:fs/promises";
import type { MemoryDocument } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  rpc,
  signup,
} from "./helpers";

test("memory is readable and editable in the app", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const userName = `Knowledge ${stamp}`;
  await signup(page, `knowledge-${stamp}@engaz.test`, "password12", userName);
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  // Space-wide documents live in Settings → Memory. Open that before bot
  // settings so the Knowledge Memory tab cannot steal this click.
  await openUserSettings(page, "memory");
  await expect(page.getByLabel("Close memory settings")).toBeVisible();
  const spaceDocs = page.getByTestId("space-memory-documents");
  await expect(spaceDocs.getByText("Shared documents")).toBeVisible();
  const memoryRow = spaceDocs.getByRole("button", { name: /MEMORY\.md/ });
  await expect(memoryRow).toBeVisible();
  await memoryRow.click();
  const docEditor = spaceDocs.locator("textarea");
  const marker = `Edited in e2e ${stamp}`;
  await docEditor.fill(`# Memory\n\n${marker}\n`);
  await captureScreenshot(page, testInfo, "83-space-memory-editor");
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(
    "**/rpc/memory/update",
    async (route) => {
      await saveGate;
      await route.continue();
    },
    { times: 1 },
  );
  await spaceDocs.getByRole("button", { name: "Save", exact: true }).click();
  try {
    await expect(docEditor).toBeDisabled();
    await expect(memoryRow).toBeDisabled();
    await expect(spaceDocs.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  } finally {
    releaseSave();
  }
  await expect(spaceDocs.getByText("rev 2")).toBeVisible();

  // The save persisted: reopen the document and find the marker.
  await memoryRow.click();
  await expect(docEditor).toHaveValue(new RegExp(marker));
  await captureScreenshot(page, testInfo, "84-space-memory-saved");
  const sharedDocuments = await rpc<MemoryDocument[]>(page, "memory/list", { scope: "user" });
  expect(sharedDocuments).toContainEqual(
    expect.objectContaining({ content: `# Memory\n\n${marker}\n`, revision: 2 }),
  );
  // Export must fetch fresh content and exclude the bot's private document.
  const sharedDocument = sharedDocuments.find((doc) => doc.path === "MEMORY.md")!;
  const latestMarker = `Latest shared memory ${stamp}`;
  await rpc(page, "memory/update", { documentId: sharedDocument.id, content: latestMarker });
  const downloadPromise = page.waitForEvent("download");
  await spaceDocs.getByRole("button", { name: "Download as markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("space-memory.md");
  const exported = await readFile((await download.path())!, "utf8");
  expect(exported).toContain(latestMarker);
  expect(exported).not.toContain(marker);
  expect(exported).not.toContain("# Chief");
  await page.getByLabel("Close memory settings").click();
  await expect(page.getByLabel("Close memory settings")).toHaveCount(0);

  // The bot's Knowledge section lives under Advanced in its settings panel.
  await page
    .locator("main")
    .getByRole("button", { name: /^Chief/ })
    .click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await settings.getByText("Advanced", { exact: true }).click();
  const knowledge = settings.getByTestId("bot-knowledge");
  await expect(knowledge).toBeVisible();

  // Bot creation seeds MEMORY.md (`# Chief`); edit it and assert the revision bumps.
  const botMemory = knowledge.getByTestId("bot-knowledge-memory");
  const botMemoryRow = botMemory.getByRole("button", { name: /MEMORY\.md/ });
  await expect(botMemoryRow).toBeVisible();
  await botMemoryRow.click();
  const botDocEditor = botMemory.locator("textarea");
  await expect(botDocEditor).toHaveValue(/# Chief/);
  const botMarker = `Bot memory e2e ${stamp}`;
  await botDocEditor.fill(`# Chief\n\n${botMarker}\n`);
  await botMemory.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "80-knowledge-bot-memory");
  await botMemory.getByRole("button", { name: "Save", exact: true }).click();
  await expect(botMemory.getByText("rev 2")).toBeVisible();
  expect(
    await rpc<MemoryDocument[]>(page, "memory/list", {
      botId: activeBotId(page),
      scope: "bot",
    }),
  ).toContainEqual(expect.objectContaining({ content: `# Chief\n\n${botMarker}\n`, revision: 2 }));
  await botMemoryRow.click();
  await expect(botDocEditor).toHaveValue(new RegExp(botMarker));
  await botMemory.getByRole("button", { name: "Cancel", exact: true }).click();
});
