import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createBotFromPicker,
  signup,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signup(page, `chat-recovery-${Date.now()}@engaz.test`, "password12", "Chat Recovery");
  await completeOnboarding(page);
});

test("drafts survive switching chats and reloading the same tab", async ({ page }) => {
  await page
    .getByRole("combobox", { name: "Message Chief", exact: true })
    .fill("Keep my Chief draft");
  await page.locator('input[type="file"]').setInputFiles({
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("draft"),
  });
  await createBotFromPicker(page, { name: "Second" });
  await page
    .getByRole("combobox", { name: "Message Second", exact: true })
    .fill("Separate second draft");
  await page
    .getByTestId("bots-sidebar")
    .getByRole("button", { name: /^Chief / })
    .click();
  await expect(page.getByRole("button", { name: "Remove draft.txt" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Message Chief", exact: true })).toHaveValue(
    "Keep my Chief draft",
  );
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Message Chief", exact: true })).toHaveValue(
    "Keep my Chief draft",
  );
});

test("failed uploads preserve the message and attachment for retry", async ({ page }, testInfo) => {
  await page.route("**/rpc/artifacts/create", (route) => route.abort("failed"));
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Do not lose this caption");
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("composer-error")).toBeVisible();
  await expect(composer).toHaveValue("Do not lose this caption");
  await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeVisible();
  await captureScreenshot(page, testInfo, "chat-upload-retry-draft");
  await page.unroute("**/rpc/artifacts/create");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeHidden();
});

test("an accepted send clears the draft even when its refresh fails", async ({ page }) => {
  let accepted = false;
  await page.route("**/rpc/threads/send", async (route) => {
    const response = await route.fetch();
    accepted = response.ok();
    await route.fulfill({ response });
  });
  await page.route("**/rpc/threads/get", (route) =>
    accepted ? route.abort("failed") : route.continue(),
  );
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Accepted before refresh failed");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(page.getByTestId("composer-error")).toBeHidden();
  await expect(
    page
      .getByTestId("message-user-bubble")
      .getByText("Accepted before refresh failed", { exact: true }),
  ).toBeVisible();
});

test("a lost send response can be retried after reload without duplicating the message", async ({
  page,
}) => {
  const nonces: string[] = [];
  await page.route("**/rpc/threads/send", async (route) => {
    nonces.push(route.request().postDataJSON().json.clientNonce);
    if (nonces.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Only one accepted message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("composer-error")).toBeVisible();
  await expect(composer).toHaveValue("Only one accepted message");
  await page.reload();
  await expect(composer).toHaveValue("Only one accepted message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("");
  expect(nonces).toHaveLength(2);
  expect(nonces[1]).toBe(nonces[0]);
  await expect(
    page.getByTestId("message-user-bubble").getByText("Only one accepted message", { exact: true }),
  ).toHaveCount(1);
});

test("a pending send clears the remounted composer without erasing a newer draft", async ({
  page,
}) => {
  const chiefId = activeBotId(page);
  await createBotFromPicker(page, { name: "Second" });
  const secondId = activeBotId(page);
  // Switch through the app so the same Shell remains mounted.
  const switchTo = (id: string) => page.locator(`[data-roster-bot-id="${id}"]`).first().click();
  await switchTo(chiefId);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/threads/send", async (route) => {
    await held;
    await route.continue();
  });
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Pending message");
  const requested = page.waitForRequest("**/rpc/threads/send");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await requested;
  await switchTo(secondId);
  await switchTo(chiefId);
  await expect(composer).toHaveValue("Pending message");
  release();
  await expect(composer).toHaveValue("");
  await page.unroute("**/rpc/threads/send");
  let finish!: () => void;
  const nextHeld = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/rpc/threads/send", async (route) => {
    await nextHeld;
    await route.continue();
  });
  await composer.fill("Another pending message");
  const nextRequested = page.waitForRequest("**/rpc/threads/send");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await nextRequested;
  await composer.fill("My next unsent draft");
  finish();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(composer).toHaveValue("My next unsent draft");
});

test("reply context survives a lost response and reload without a duplicate", async ({ page }) => {
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Original reply target");
  await composer.press("Enter");
  const row = page
    .getByTestId("transcript")
    .locator("[data-message-id]")
    .filter({
      has: page
        .getByTestId("message-user-bubble")
        .getByText("Original reply target", { exact: true }),
    });
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  const requests: { clientNonce: string; replyToMessageId: string }[] = [];
  await page.route("**/rpc/threads/send", async (route) => {
    requests.push(route.request().postDataJSON().json);
    if (requests.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await composer.fill("Retry the same reply");
  await composer.press("Enter");
  await expect(page.getByTestId("composer-error")).toBeVisible();
  await page.reload();
  await expect(composer).toHaveValue("Retry the same reply");
  await expect(page.getByTestId("reply-chip")).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  expect(requests).toHaveLength(2);
  expect(requests[1]!.clientNonce).toBe(requests[0]!.clientNonce);
  expect(requests[1]!.replyToMessageId).toBe(requests[0]!.replyToMessageId);
  await expect(
    page.getByTestId("message-user-bubble").getByText("Retry the same reply", { exact: true }),
  ).toHaveCount(1);
});

test("a pending upload cannot restore chat storage after logout", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/artifacts/create", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page
    .getByRole("combobox", { name: "Message Chief", exact: true })
    .fill("Private pending draft");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "private.txt", mimeType: "text/plain", buffer: Buffer.from("private") });
  const uploading = page.waitForRequest("**/rpc/artifacts/create");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await uploading;
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Engaz" })).toBeVisible();
  const sent = page.waitForResponse("**/rpc/threads/send");
  release();
  await sent;
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter(
        (key) => key.startsWith("engaz:chat-draft:") || key.startsWith("engaz:chat-send:"),
      ),
    ),
  ).toEqual([]);
});
