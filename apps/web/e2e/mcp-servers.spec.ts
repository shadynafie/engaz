import type { McpServer } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("the owner finds a server in the public catalog and gives it to their agent", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/capabilities/catalogSearch", (route) => {
    expect(route.request().postDataJSON().json).toEqual({
      query: "treg",
      usePublicCatalog: true,
    });
    return route.fulfill({
      json: {
        json: {
          enabled: true,
          results: [
            {
              domain: "treg.to",
              name: "Treg",
              description: "",
              pageUrl: null,
              // The emulator answers for this address when the API checks it.
              surfaces: [{ kind: "mcp", slug: "treg", source: "https://treg.to/mcp/", auth: null }],
            },
          ],
        },
      },
    });
  });
  await signup(page, `mcp-find-${Date.now()}@engaz.test`, "password12", "MCP Find");
  await completeOnboarding(page);

  await page.getByText("Integrations", { exact: true }).click();
  // MCP servers have one way in: the row at the top of Integrations.
  await expect(page.getByRole("button", { name: "Browse MCP servers" })).toBeHidden();
  await page.getByTestId("integrations-mcp").click();

  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  await page.getByText("Find a server", { exact: true }).click();
  await page.getByRole("textbox", { name: "Search apps" }).fill("treg");
  // Enter searches rather than submitting the empty add form.
  await page.getByRole("textbox", { name: "Search apps" }).press("Enter");
  await page.getByRole("button", { name: /Treg/ }).click();
  await expect(page.getByLabel("Server address")).toHaveValue("https://treg.to/mcp/");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Treg");
  await expect(page.getByRole("checkbox", { name: "Chief", exact: true })).toBeChecked();
  await captureScreenshot(page, testInfo, "mcp-find-a-server");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Working · 1 tool")).toBeVisible();
  await expect(page.getByText("Used by Chief")).toBeVisible();
});

test("a server whose token stopped working takes a new one without losing its agents", async ({
  page,
}, testInfo) => {
  await signup(page, `mcp-token-${Date.now()}@engaz.test`, "password12", "MCP Token");
  await completeOnboarding(page);
  const server = await rpc<McpServer>(page, "mcp/servers/create", {
    slug: "treg",
    name: "Treg",
    transport: "streamable_http",
    endpoint: "https://treg.to/mcp/",
    secret: "fake-old-token",
    headers: { "X-Test": "fake-header" },
  });
  const bots = await rpc<{ id: string }[]>(page, "bots/list", {});
  await rpc(page, "mcp/assignments/approve", { botId: bots[0]!.id, serverId: server.id });

  // Show the server as the API would after its token was refused.
  await page.route("**/rpc/mcp/servers/list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.json = body.json.map((row: McpServer) => ({
      ...row,
      check: { ...row.check, status: "failing", message: "The server refused the access token." },
    }));
    await route.fulfill({ response, json: body });
  });
  let updated: McpServer | null = null;
  await page.route("**/rpc/mcp/servers/update", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: { id: server.id, secret: "fake-new-token" },
    });
    const response = await route.fetch();
    updated = (await response.json()).json;
    await route.fulfill({ response });
  });

  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  await expect(page.getByText("The server refused the access token.")).toBeVisible();
  await page.getByLabel("New access token").fill("fake-new-token");
  await captureScreenshot(page, testInfo, "mcp-replace-token");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Working · 1 tool")).toBeVisible();
  await expect(page.getByLabel("New access token")).toBeHidden();
  await expect(page.getByRole("switch", { name: "Chief" })).toBeChecked();
  expect(updated!.headerKeys).toEqual(["X-Test"]);
});
