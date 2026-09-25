import type { BotMcpServer, McpServer } from "@engaz/contracts";
import { expect, type Page, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const USE_TOOL = "use the mcp tool mcp__treg__notes.write";

test("an agent uses the one tool it was given, and cannot once it is taken away", async ({
  page,
}, testInfo) => {
  await signup(page, `mcp-gate-${Date.now()}@engaz.test`, "password12", "MCP Gate");
  await completeOnboarding(page);
  const chiefId = activeBotId(page);
  const server = await rpc<McpServer>(page, "mcp/servers/create", {
    slug: "treg",
    name: "Treg",
    transport: "streamable_http",
    endpoint: "https://treg.to/mcp/",
    secret: "fake-treg-browser-credential",
  });
  expect(server.check.status).toBe("working");
  // Giving Chief the server grants the one tool it offers: notes.write.
  await rpc(page, "mcp/assignments/approve", { botId: chiefId, serverId: server.id });
  // Ask first, so the action is visible before it runs.
  await rpc(page, "approvalRules/set", {
    effect: "require_approval",
    matchKind: "connector",
    matchValue: "mcp",
  });

  await send(page, USE_TOOL);
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // The card says what the tool does, in the server's words.
  await expect(page.getByText("Review: Write a deterministic emulated note").last()).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-gate-action");
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(page.getByText("Allowed once", { exact: true })).toBeVisible();
  await waitForRunIdle(page, chiefId);

  // Take the server away from Chief on the MCP servers screen.
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  const revoked = page.waitForResponse(
    (response) => response.url().includes("/rpc/mcp/assignments/replace") && response.ok(),
  );
  await page.getByRole("switch", { name: "Chief" }).click();
  await revoked;
  await expect(page.getByText("No agent uses it yet")).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-gate-revoked");
  await page.getByRole("button", { name: "Close MCP servers" }).click();
  const assignments = await rpc<BotMcpServer[]>(page, "mcp/assignments/all", {});
  expect(assignments.filter((entry) => entry.botId === chiefId)).toEqual([]);

  // The same request no longer reaches the tool, so there is nothing to approve.
  await send(page, USE_TOOL);
  await waitForRunIdle(page, chiefId);
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
});

async function send(page: Page, prompt: string) {
  const composer = page.getByPlaceholder(/Message/);
  await expect(composer).toBeEnabled();
  await composer.fill(prompt);
  const sent = page.waitForResponse(
    (response) => response.url().includes("/rpc/threads/send") && response.ok(),
  );
  await page.keyboard.press("Enter");
  await sent;
}

async function waitForRunIdle(page: Page, botId: string) {
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? null;
      },
      { timeout: 30_000 },
    )
    .toBeNull();
}
