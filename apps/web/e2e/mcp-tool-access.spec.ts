import type { BotMcpServer, McpServer } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("the owner chooses which of a server's tools an agent may use", async ({ page }, testInfo) => {
  await signup(page, `mcp-tools-${Date.now()}@engaz.test`, "password12", "MCP Tools");
  await completeOnboarding(page);

  const server: McpServer = {
    id: "mcp-tools-server",
    spaceId: "mcp-tools-space",
    slug: "crawler",
    name: "Crawler",
    description: "",
    transport: "streamable_http",
    endpoint: "http://192.168.1.20:4001/mcp",
    command: null,
    args: [],
    envKeys: [],
    headerKeys: [],
    hasSecret: false,
    oauthStatus: "none",
    check: {
      status: "working",
      message: null,
      checkedAt: "2026-09-25T10:00:00.000Z",
      tools: ["search", "scrape", "screenshot"],
    },
    enabled: true,
    revision: 1,
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
  };
  let botId = "";
  let assignment: BotMcpServer | null = null;
  const replaced: unknown[] = [];
  let botsLoaded = () => {};
  const botsReady = new Promise<void>((resolve) => {
    botsLoaded = resolve;
  });
  await page
    .context()
    .route("**/rpc/mcp/servers/list", (route) => route.fulfill({ json: { json: [server] } }));
  await page.context().route("**/rpc/bots/list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    botId = body.json[0].id;
    // A new assignment starts with the tools the server offered when it was added.
    assignment = {
      id: "assignment-1",
      botId,
      serverId: server.id,
      allowAllTools: false,
      allowedTools: ["search", "scrape", "screenshot"],
      createdAt: "2026-09-25T10:00:00.000Z",
      updatedAt: "2026-09-25T10:00:00.000Z",
    };
    await route.fulfill({ response, json: body });
    botsLoaded();
  });
  await page.context().route("**/rpc/mcp/assignments/all", async (route) => {
    await botsReady;
    await route.fulfill({ json: { json: assignment ? [assignment] : [] } });
  });
  await page.context().route("**/rpc/mcp/assignments/replace", (route) => {
    const input = route.request().postDataJSON().json;
    replaced.push(input);
    assignment = assignment && { ...assignment, ...input.assignments[0] };
    return route.fulfill({ json: { json: assignment ? [assignment] : [] } });
  });

  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-advanced").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await page.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(page.getByText("Crawler", { exact: true })).toBeVisible();
  await page.locator("summary", { hasText: "Tools" }).click();
  const screenshotTool = page.getByRole("checkbox", { name: "screenshot" });
  await expect(screenshotTool).toBeChecked();
  await screenshotTool.click();
  await expect
    .poll(() => replaced)
    .toEqual([
      {
        botId,
        assignments: [
          { serverId: server.id, allowAllTools: false, allowedTools: ["search", "scrape"] },
        ],
      },
    ]);
  await expect(screenshotTool).not.toBeChecked();
  await captureScreenshot(page, testInfo, "mcp-tool-access");
});
