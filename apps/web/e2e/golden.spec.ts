import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  realSandboxTimeout,
  rpc,
  signup,
} from "./helpers";

function sidebarBotButton(page: Page, name: RegExp | string) {
  return page.locator("[data-sidebar-group] [data-roster-bot-id]").filter({
    has: page.locator("[data-roster-bot-name]").filter({ hasText: name }),
  });
}

async function expectCentredChatLayout(page: Page) {
  const geometry = await page.getByTestId("chat-column").evaluate((column) => {
    const main = column.closest("main")!;
    const rect = column.getBoundingClientRect();
    const area = main.getBoundingClientRect();
    const composer = main.querySelector("fieldset")!.getBoundingClientRect();
    const header = main
      .querySelector('[data-testid="bot-settings-trigger"]')!
      .getBoundingClientRect();
    return {
      width: rect.width,
      centre: Math.abs(rect.x + rect.width / 2 - area.x - area.width / 2),
      composerEdge: Math.abs(rect.x - composer.x),
      composerWidth: Math.abs(rect.width - composer.width),
      headerCentre: Math.abs(header.x + header.width / 2 - area.x - area.width / 2),
    };
  });
  expect(geometry.width).toBeLessThanOrEqual(896);
  expect(geometry.centre).toBeLessThan(1);
  expect(geometry.composerEdge).toBeLessThan(1);
  expect(geometry.composerWidth).toBeLessThan(1);
  expect(geometry.headerCentre).toBeLessThan(1);
}

test.describe.configure({ mode: "serial" });

test("two users are isolated and a bot completes durable work", async ({ browser }, testInfo) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  const stamp = Date.now();
  await signup(pageA, `ada-${stamp}@engaz.test`, "password12", "Ada", testInfo);
  await completeOnboarding(pageA, testInfo);
  await expect(pageA.getByText("Chief").first()).toBeVisible();

  await signup(pageB, `bob-${stamp}@engaz.test`, "password12", "Bob");
  await completeOnboarding(pageB);
  await expect(pageB.getByText("Chief").first()).toBeVisible();
  await expect(pageB.getByText("Ada", { exact: true })).toHaveCount(0);

  const composer = pageA.getByPlaceholder(/Message/);
  await composer.fill("write a file in your home called notes/result.txt that says isolation-ok");
  await pageA.keyboard.press("Enter");
  await expect(
    pageA.getByText(/writing that into my home|isolation-ok|handled/i).first(),
  ).toBeVisible({
    timeout: 30_000,
  });

  await pageA.reload();
  await expect(pageA.getByText(/isolation-ok|writing that into my home/i).first()).toBeVisible();
  await captureScreenshot(pageA, testInfo, "07-durable-bot-work");

  await a.close();
  await b.close();
});

test("takeover, routine, plugins, and export are reachable", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `flow-${stamp}@engaz.test`, "password12", "Flow");
  await completeOnboarding(page);

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("install the gsc cli and sign in");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/handing you the computer|sign in to continue|protected input/i).first(),
  ).toBeVisible({ timeout: realSandboxTimeout(90_000, 30_000) });
  await expect
    .poll(() => threadRunStatus(page), {
      timeout: realSandboxTimeout(90_000, 30_000),
      message: "the protected-input run must be ready for takeover",
    })
    .toBe("waiting_takeover");
  const computerCard = page.getByTestId("computer-card");
  await expect(computerCard).toBeVisible();
  await expect(computerCard.getByText("Needs you", { exact: true })).toBeVisible();
  await expect(computerCard.getByTestId("computer-card-open")).toBeVisible();
  await captureScreenshot(page, testInfo, "08-protected-input-request");
  await computerCard.getByTestId("computer-card-open").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip", exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "I’m done", exact: true }).last()).toBeVisible();
  if (process.env.SANDBOX_PROVIDER === "box") await waitForBoxFramebuffer(page);
  await captureScreenshot(page, testInfo, "09-computer-takeover-outcomes");
  await page.getByRole("button", { name: "I’m done", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeHidden();
  await expect(page.getByText(/signed in|session stays/i).first()).toBeVisible({
    timeout: realSandboxTimeout(90_000, 30_000),
  });

  await composer.fill("sign in again so I can skip this time");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => threadRunStatus(page), {
      timeout: realSandboxTimeout(90_000, 30_000),
      message: "the second protected-input run must be ready for takeover",
    })
    .toBe("waiting_takeover");
  // Agent computer toggles the panel. Re-open when closed so Open can refresh computer status.
  const sidePanel = page.getByTestId("side-panel");
  if ((await sidePanel.getAttribute("data-panel")) === "computer") {
    await page.getByTitle("Agent computer").click();
  }
  await page.getByTitle("Agent computer").click();
  await expect(sidePanel).toHaveAttribute("data-panel", "computer");
  await expect(sidePanel).toHaveCSS("width", "384px");
  const [mainBox, panelBox] = await Promise.all([
    page.locator("main").boundingBox(),
    sidePanel.boundingBox(),
  ]);
  expect(mainBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect((mainBox?.x ?? 0) + (mainBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
  await sidePanel.getByTestId("computer-preview").hover();
  const openComputer = sidePanel.getByTestId("computer-preview-open");
  await expect(openComputer).toBeVisible({ timeout: 30_000 });
  await openComputer.click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeHidden();
  await expect(page.getByText(/login was skipped/i).last()).toBeVisible({
    timeout: realSandboxTimeout(90_000, 30_000),
  });
  await captureScreenshot(page, testInfo, "09a-computer-takeover-skipped");

  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.locator("label:has-text('Name') input").fill("Monday briefing");
  await page
    .locator("label:has-text('Instruction') textarea")
    .fill("write a file in your home called notes/result.txt that says routine-ok");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "On a schedule" }).hover();
  await page.getByRole("menuitem", { name: "Every day", exact: true }).click();
  const savedRoutine = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/create") && response.ok(),
  );
  await page.getByRole("button", { name: "Save" }).click();
  await savedRoutine;
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("Monday briefing")).toBeVisible();
  await captureScreenshot(page, testInfo, "10-routine-created");

  await page.getByText("Integrations").click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  const featured = page.getByTestId("featured-connectors");
  await expect(featured).toContainText(
    /Gmail[\s\S]*Google Calendar[\s\S]*Google Drive[\s\S]*Slack[\s\S]*Notion/,
  );
  await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Executor", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add Treg", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add MCP server", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add OpenAPI", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add GraphQL", exact: true })).toBeHidden();
  await expect(page.getByText("Tool sources", { exact: true })).toBeHidden();
  await expect(
    page.getByText("Connect apps or add Treg, MCP, and OpenAPI tool sources.", { exact: true }),
  ).toBeHidden();
  await captureScreenshot(page, testInfo, "11-plugins-catalog");

  // Nearest ancestor with an Add/Added control (featured tile or catalog row).
  const gmailRow = featured
    .getByText("Gmail", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]");
  await gmailRow.getByRole("button", { name: "Add", exact: true }).click();
  await expect(gmailRow.getByRole("button", { name: "Added", exact: true })).toBeVisible();
  await expect(page.getByTestId("connection-tile-gmail")).toBeVisible();
  await captureScreenshot(page, testInfo, "11a-connected-plugins");

  await gmailRow.getByRole("button", { name: "Added", exact: true }).click();
  const detail = page.getByTestId("connection-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByTestId("connection-accounts")).toBeVisible();
  await expect(page.getByTestId("connection-tools")).toBeVisible();

  await detail.getByRole("button", { name: "Add another", exact: true }).click();
  await expect(detail.getByLabel("Account label")).toHaveCount(2);
  await detail.getByLabel("Account label").nth(1).fill("Work");
  const renamed = page.waitForResponse(
    (response) => response.url().includes("connections/rename") && response.ok(),
  );
  await detail.getByLabel("Account label").nth(1).blur();
  await renamed;
  await expect(detail.getByLabel("Account label").nth(1)).toHaveValue("Work");
  await captureScreenshot(page, testInfo, "11a2-multi-account-plugins");

  await page.getByRole("button", { name: "Close integrations" }).click();
  await page.getByText("Integrations").click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  const gmailTileAgain = page.getByTestId("connection-tile-gmail");
  await expect(gmailTileAgain.getByRole("button", { name: "Added", exact: true })).toBeVisible();
  await gmailTileAgain.click();
  const detailAgain = page.getByTestId("connection-detail");
  await expect(detailAgain.getByLabel("Account label")).toHaveCount(2);
  await expect(detailAgain.getByLabel("Account label").nth(1)).toHaveValue("Work");

  await detailAgain.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(detailAgain.getByLabel("Account label")).toHaveCount(1);
  await detailAgain.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(page.getByTestId("connection-detail")).toHaveCount(0);
  const gmailRowEmpty = page
    .getByTestId("featured-connectors")
    .getByText("Gmail", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]");
  await expect(gmailRowEmpty.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "11b-connected-plugins-empty");

  const linearRow = page
    .getByText("Linear", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]");
  const connectPopup = page.waitForEvent("popup");
  await linearRow.getByRole("button", { name: "Add", exact: true }).click();
  const popup = await connectPopup;
  await popup.close();
  await expect(linearRow.getByRole("button", { name: "Added", exact: true })).toBeVisible();
  await linearRow.getByRole("button", { name: "Added", exact: true }).click();
  const linearDetail = page.getByTestId("connection-detail");
  await expect(linearDetail).toBeVisible();
  await linearDetail.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(page.getByTestId("connection-detail")).toHaveCount(0);
  await expect(linearRow.getByRole("button", { name: "Add", exact: true })).toBeVisible();

  const advanced = page.getByTestId("integrations-advanced");
  await advanced.evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  // MCP servers have one home, reachable without opening Advanced.
  await expect(page.getByTestId("integrations-mcp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add MCP server", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add OpenAPI", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add GraphQL", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Executor", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Treg", exact: true })).toBeVisible();
  await expect(page.getByText("Tool sources", { exact: true })).toBeVisible();
  // Thin Advanced smoke only. GraphQL install and order screenshots live in graphql-integrations.spec.ts.
  await expect(page.getByTestId("integrations-catalog-feed")).toBeVisible();
  // Catalog Search is optional chrome; add buttons stay OpenAPI → GraphQL → Executor → Treg.
  const advancedActions = advanced.getByTestId("integrations-advanced-add").locator("button");
  await expect(advancedActions).toHaveCount(4);
  await expect(advancedActions.nth(0)).toHaveText("Add OpenAPI");
  await expect(advancedActions.nth(1)).toHaveText("Add GraphQL");
  await expect(advancedActions.nth(2)).toHaveText("Add Executor");
  await expect(advancedActions.nth(3)).toHaveText("Add Treg");

  const feed = page.getByTestId("integrations-catalog-feed");
  await feed.getByRole("textbox", { name: "Integration domain" }).fill("github.com");
  await feed.getByRole("button", { name: "Search", exact: true }).click();
  await expect(feed.getByText("GitHub", { exact: true })).toBeVisible();
  await expect(feed.getByRole("button", { name: "MCP · Add", exact: true })).toBeVisible();
  await expect(feed.getByRole("button", { name: "OPENAPI · Add", exact: true })).toBeVisible();
  await expect(feed.getByRole("button", { name: "GRAPHQL · Manual", exact: true })).toBeDisabled();
  await expect(feed.getByRole("button", { name: "CLI · Manual", exact: true })).toBeDisabled();
  // Editing the query must drop prior results so a stale Add cannot run for the old domain.
  await feed.getByRole("textbox", { name: "Integration domain" }).fill("gitlab.com");
  await expect(feed.getByText("GitHub", { exact: true })).toBeHidden();
  await feed.getByRole("textbox", { name: "Integration domain" }).fill("github.com");
  await feed.getByRole("button", { name: "Search", exact: true }).click();
  await expect(feed.getByText("GitHub", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "11c-catalog-feed");

  // An MCP result opens the MCP servers screen, filled in from the catalog.
  await feed.getByRole("button", { name: "MCP · Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("GitHub");
  await expect(page.getByLabel("Server address")).toHaveValue("https://mcp.example.test/mcp");
  await expect(page.getByLabel("Access token (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Close MCP servers" }).click();

  // Presets do the same: Treg opens with its address and the token field ready.
  await page.getByText("Integrations").click();
  await page.getByTestId("integrations-advanced").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await page.getByRole("button", { name: "Add Treg", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Treg");
  await expect(page.getByLabel("Server address")).toHaveValue("https://treg.to/mcp/");
  await page.getByLabel("Access token (optional)").fill("fake-treg-browser-credential");
  await page.getByRole("checkbox", { name: "Chief", exact: true }).check();
  await captureScreenshot(page, testInfo, "11b2-add-mcp-server");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Working · 1 tool")).toBeVisible();
  await expect(page.getByText("Used by Chief")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Chief" })).toBeChecked();
  await captureScreenshot(page, testInfo, "11b3-mcp-server-added");
  await page.getByRole("button", { name: "Close MCP servers" }).click();

  await page.getByText("Integrations").click();
  await page.getByTestId("integrations-advanced").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await page.getByRole("button", { name: "Add OpenAPI", exact: true }).click();
  await page.getByPlaceholder("Display name").fill("Browser API");
  await page
    .getByPlaceholder("https://example.com/openapi.json")
    .fill("https://api.example.test/openapi.json");
  await page.locator("select").selectOption("bearer");
  await page.getByPlaceholder("Credential").fill("fake-openapi-browser-credential");
  await page.getByRole("button", { name: "Verify and add", exact: true }).click();
  await expect(
    page.getByText(/API · https:\/\/api\.example\.test\/v1 · credential saved/),
  ).toBeVisible();

  await captureScreenshot(page, testInfo, "11d-provider-emulators");

  await page.getByRole("button", { name: "Close integrations" }).click();

  await page.getByText("Chief").first().click();
  const gear = page.getByRole("button", { name: "Show settings" });
  if (!(await gear.isVisible().catch(() => false))) {
    await page.getByTitle("Agent computer").click();
  }
  await gear.click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/chief-export\.json/i);
  const settings = page.getByTestId("bot-settings");
  // The agent's own settings show what it can use and link back to Integrations.
  const agentPlugins = settings.getByTestId("agent-plugins");
  await expect(agentPlugins.getByText("Treg", { exact: true })).toBeVisible();
  await expect(agentPlugins.getByText("1 of 1 tool", { exact: true })).toBeVisible();
  await expect(agentPlugins.getByText("Browser API", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "11e-agent-plugins");
  await expect(settings.getByRole("button", { name: "Archive bot" })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Delete bot" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close panel" }).click();

  await page.locator("aside").first().getByRole("button", { name: /Chief/ }).first().click({
    button: "right",
  });
  const botMenu = page.getByRole("menu", { name: "Actions for Chief" });
  await expect(botMenu.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await botMenu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("radio", { name: /Keep memories/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Delete memories too/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await captureScreenshot(page, testInfo, "12-bot-settings");
});

test("sign-in, spawn, and stop work in the shell", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  const capabilitiesUrl = new URL("/api/auth/capabilities", testInfo.project.use.baseURL).href;
  page.on("requestfailed", (request) => {
    // Optional auth capabilities have an 8s deadline and safely fall back on abort.
    // Keep every other endpoint, method, and failure type in the assertion.
    if (
      request.method() === "GET" &&
      request.url() === capabilitiesUrl &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      return;
    }
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  const stamp = Date.now();
  const email = `shell-${stamp}@engaz.test`;
  await signup(page, email, "password12", "Shell");
  await completeOnboarding(page);
  await page.evaluate(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
  });

  const composer = page.locator('textarea[name="chat-message"]');
  await composer.fill("spawn a bot named Scout to research venues");
  await page.keyboard.press("Enter");
  await expect(sidebarBotButton(page, /Scout/)).toBeVisible({
    timeout: 30_000,
  });
  await captureScreenshot(page, testInfo, "13-spawned-bot");

  await page
    .locator("[data-sidebar-group]")
    .getByRole("button", { name: /^Chief/ })
    .click();
  const portrait = await readFile(
    new URL("../../../packages/ui-tokens/assets/agent-portraits/team-chief.webp", import.meta.url),
  );
  await rpc(page, "bots/update", {
    botId: activeBotId(page),
    color: `data:image/webp;base64,${portrait.toString("base64")}`,
    title: "Team lead",
  });
  await page.reload();
  await page.setViewportSize({ width: 1768, height: 900 });
  const agentHeader = page.getByTestId("bot-settings-trigger");
  await expect(agentHeader).toContainText("Chief · Team lead");
  await expectCentredChatLayout(page);
  await agentHeader.click();
  await expect(agentHeader).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("side-panel")).toHaveCSS("width", "384px");
  await expectCentredChatLayout(page);
  await captureScreenshot(page, testInfo, "13-centred-chat-with-panel");
  await agentHeader.click();
  await expect(page.getByTestId("side-panel")).toHaveCSS("width", "0px");
  await expect(agentHeader).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await composer.fill("keep working until I stop you");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("composer-steering-status")).toHaveCount(0);
  await expect(page.getByText("Messages sent now guide the next turn.")).toHaveCount(0);
  await expect(page.getByText(/^Steer /)).toHaveCount(0);
  await expect(composer).toHaveAttribute("placeholder", "Message Chief");
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await composer.fill("Use the newer report and keep the answer short.");
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("transcript").getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  const activityStop = page
    .getByTestId("transcript")
    .getByRole("button", { name: "Stop", exact: true });
  await expect(activityStop).toHaveCSS("background-color", "rgb(26, 26, 26)");
  await expect(activityStop).toHaveCSS("color", "rgb(241, 241, 239)");
  await captureScreenshot(page, testInfo, "14-working-with-draft");
  await page.keyboard.press("Tab");
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Voice", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("transcript").getByText("Use the newer report and keep the answer short."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const workStatus = page
    .getByTestId("transcript")
    .getByRole("status")
    .filter({ hasText: "Chief is working" });
  await expect(workStatus).toBeVisible();
  const userBubble = page
    .getByTestId("transcript")
    .getByText("Use the newer report and keep the answer short.", { exact: true });
  await expect(userBubble).toHaveCSS("background-color", "rgb(38, 38, 38)");
  await expect(userBubble).toHaveCSS("color", "rgb(241, 241, 239)");
  await expect(
    page
      .getByTestId("transcript")
      .getByTestId("message-bot-bubble")
      .filter({ hasText: "creating a bot for that." }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(userBubble).toHaveCSS("font-size", "15px");
  await expect(userBubble.locator("xpath=ancestor::div[@data-message-id]")).toHaveCSS(
    "margin-top",
    "8px",
  );
  await expect(
    page
      .getByTestId("message-bot-bubble")
      .filter({ hasText: "creating a bot for that." })
      .locator("xpath=ancestor::div[@data-message-id]"),
  ).toHaveCSS("margin-top", "24px");
  await expect(page.getByTestId("composer-bar")).not.toHaveCSS("box-shadow", "none");
  const stopControl = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stopControl).toHaveCSS("background-color", "rgb(26, 26, 26)");
  await expect(stopControl).toHaveCSS("color", "rgb(241, 241, 239)");
  await expect(stopControl).toHaveClass(/bg-primary/);

  const uploadedAvatar = workStatus.locator(".engaz-bot-avatar");
  await expect(uploadedAvatar.locator("img")).toBeVisible();
  await expect(uploadedAvatar).toHaveCSS("overflow", "visible");
  const workRing = uploadedAvatar.locator(".engaz-bot-avatar-ring");
  await expect(workRing).toHaveCSS("animation-name", "engaz-avatar-spin");
  await expect(workRing).toHaveCSS("animation-timing-function", "linear");
  await expect(workRing.locator("linearGradient stop")).toHaveCount(3);
  await expect(workRing.locator("path")).toHaveCSS("filter", /drop-shadow/);
  const ringOffset = await uploadedAvatar.evaluate((element) => {
    const avatar = element.getBoundingClientRect();
    const ring = element.querySelector("svg")!.getBoundingClientRect();
    return Math.hypot(
      avatar.x + avatar.width / 2 - ring.x - ring.width / 2,
      avatar.y + avatar.height / 2 - ring.y - ring.height / 2,
    );
  });
  expect(ringOffset).toBeLessThan(0.1);

  const ringTransform = await workRing.evaluate((element) => getComputedStyle(element).transform);
  await expect
    .poll(() => workRing.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(ringTransform);

  await expect(workStatus.locator(".font-mono")).toHaveText(/^(?:\d+m )?\d+s$/);
  await expect(workStatus).not.toContainText(/\d+\.\d+s/);
  const initialWorkTime = await workStatus.textContent();
  await expect.poll(() => workStatus.textContent()).not.toBe(initialWorkTime);
  await captureScreenshot(page, testInfo, "14-active-bot-work");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(composer).toHaveAttribute("placeholder", "Message Chief");
  await expectCentredChatLayout(page);
  await captureScreenshot(page, testInfo, "14-active-bot-work-mobile");
  const chiefId = activeBotId(page);
  const longName = "A".repeat(60);
  await rpc(page, "bots/update", { botId: chiefId, name: longName });
  await page.reload();
  await composer.fill("Keep this draft while working.");
  const narrowStatus = page.getByTestId("transcript").getByRole("status");
  await expect(narrowStatus).toContainText(longName);
  const narrowStop = page
    .getByTestId("transcript")
    .getByRole("button", { name: "Stop", exact: true });
  await expect(narrowStop).toBeVisible();
  const overflow = await narrowStop.evaluate((button) => {
    const row = button.closest('[data-testid="transcript"]')!.getBoundingClientRect();
    const stop = button.getBoundingClientRect();
    return stop.right - row.right;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await captureScreenshot(page, testInfo, "14-active-long-name-mobile");
  await rpc(page, "bots/update", { botId: chiefId, name: "Chief" });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(browserErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  let releaseStopRequest: () => void = () => undefined;
  let markStopRequestStarted: () => void = () => undefined;
  const stopRequestStarted = new Promise<void>((resolve) => {
    markStopRequestStarted = resolve;
  });
  await page.route("**/rpc/threads/stop", async (route) => {
    markStopRequestStarted();
    await new Promise<void>((release) => {
      releaseStopRequest = release;
    });
    await route.continue();
  });
  await composer.fill("Keep this unsent draft.");
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("transcript").getByRole("button", { name: "Stop", exact: true }).click();
  await stopRequestStarted;
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  releaseStopRequest();
  // Stopping from the activity row preserves the unsent message.
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(composer).toHaveValue("Keep this unsent draft.");
  await composer.fill("");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();

  await expect(workStatus).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByPlaceholder("Your email address").fill(email);
  await page.getByPlaceholder("Password").fill("password12");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  await expect(sidebarBotButton(page, /^Chief/)).toBeVisible();
  await expect(sidebarBotButton(page, /Scout/)).toBeVisible();
  await captureScreenshot(page, testInfo, "15-restored-session");
});

test("bot context menu pins, duplicates, edits, and confirms deletion", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `menu-${stamp}@engaz.test`, "password12", "Menu");
  await completeOnboarding(page);

  const chief = page.getByRole("button", { name: /Chief/ }).first();
  await chief.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for Chief" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit Profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await captureScreenshot(page, testInfo, "16-bot-context-menu");
  await page.getByRole("menuitem", { name: "Mark as Unread" }).click();

  // Chief is the open bot, so the auto-read on window focus must not undo the manual mark.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await chief.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Mark as Read" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Mark as Read" }).click();

  await chief.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();

  await chief.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Unpin", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByText("Chief copy").first()).toBeVisible();
  await captureScreenshot(page, testInfo, "17-pinned-and-duplicated-bot");

  const copy = page.getByRole("button", { name: /Chief copy/ }).first();
  await copy.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog", { name: "Delete Chief copy?" })).toBeVisible();
  await captureScreenshot(page, testInfo, "18-delete-confirmation");
  await page.getByRole("button", { name: "Cancel" }).click();

  await chief.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit Profile" }).click();
  await expect(page.locator("label:has-text('Name') input")).toHaveValue("Chief");
  await captureScreenshot(page, testInfo, "19-edit-profile");
});

async function threadRunStatus(page: Page) {
  const result = await rpc<{ run?: { status?: string } | null }>(page, "threads/get", {
    botId: activeBotId(page),
  });
  return result.run?.status ?? "idle";
}

async function waitForBoxFramebuffer(page: Page) {
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          const canvas = frame.locator("canvas").first();
          if ((await canvas.count()) === 0) continue;
          const ready = await canvas
            .evaluate((element) => {
              const framebuffer = element as HTMLCanvasElement;
              return framebuffer.width > 0 && framebuffer.height > 0;
            })
            .catch(() => false);
          if (ready) return true;
        }
        return false;
      },
      { timeout: 60_000, message: "the Box noVNC framebuffer must be ready" },
    )
    .toBe(true);
}
