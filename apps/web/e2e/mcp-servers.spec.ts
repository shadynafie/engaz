import type { BotMcpServer, McpServer } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("the owner finds a server in the public catalog and gives it to their agent", async ({
  page,
}, testInfo) => {
  const searches: unknown[] = [];
  await page.route("**/rpc/capabilities/catalogSearch", (route) => {
    const input = route.request().postDataJSON().json;
    // Integrations probes its own catalog with an empty query; only the public search is faked.
    if (!input.usePublicCatalog) return route.continue();
    searches.push(input);
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
  expect(searches).toEqual([{ query: "treg", usePublicCatalog: true }]);
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
  const updates: unknown[] = [];
  await page.route("**/rpc/mcp/servers/update", async (route) => {
    updates.push(route.request().postDataJSON().json);
    await route.continue();
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
  expect(updates).toEqual([{ id: server.id, secret: "fake-new-token" }]);
  // Only the token changed; the server's other credentials stay.
  const [saved] = await rpc<McpServer[]>(page, "mcp/servers/list", {});
  expect(saved!.headerKeys).toEqual(["X-Test"]);
});

test("edits a saved MCP server without changing access and keeps failed edits retryable", async ({
  page,
}, testInfo) => {
  await signup(page, `mcp-edit-${Date.now()}@engaz.test`, "password12", "MCP Edit");
  await completeOnboarding(page);
  const server = await rpc<McpServer>(page, "mcp/servers/create", {
    slug: "treg",
    name: "Treg",
    transport: "streamable_http",
    endpoint: "https://treg.to/mcp/",
    secret: "fake-token",
    headers: { "X-Test": "fake-header" },
  });
  const [bot] = await rpc<{ id: string }[]>(page, "bots/list", {});
  await rpc(page, "mcp/assignments/approve", { botId: bot!.id, serverId: server.id });
  const before = await rpc<BotMcpServer[]>(page, "mcp/assignments/all", {});
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Updated Treg");
  await captureScreenshot(page, testInfo, "mcp-edit-server");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Updated Treg", exact: true })).toBeVisible();
  const [saved] = await rpc<McpServer[]>(page, "mcp/servers/list", {});
  expect(saved!.headerKeys).toEqual(["X-Test"]);
  expect(saved!.hasSecret).toBe(true);
  expect(await rpc(page, "mcp/assignments/all", {})).toEqual(before);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Server address", { exact: true })
    .fill("https://unreachable.example.test/mcp");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Server address", { exact: true })).toHaveValue(
    "https://unreachable.example.test/mcp",
  );
  expect((await rpc<McpServer[]>(page, "mcp/servers/list", {}))[0]!.endpoint).toBe(server.endpoint);
  await page.getByLabel("Server address", { exact: true }).fill(server.endpoint!);
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByLabel("Replace headers (JSON)").fill('{"X-Test":"fake-replacement"}');
  await page.getByLabel("New access token", { exact: true }).fill("fake-new-token");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  expect(await rpc(page, "mcp/assignments/all", {})).toEqual(before);
});

test("disables an agent's permission controls until its update finishes", async ({ page }) => {
  await signup(page, `mcp-pending-${Date.now()}@engaz.test`, "password12", "MCP Pending");
  await completeOnboarding(page);
  const server = await rpc<McpServer>(page, "mcp/servers/create", {
    slug: "treg",
    name: "Treg",
    transport: "streamable_http",
    endpoint: "https://treg.to/mcp/",
  });
  const [bot] = await rpc<{ id: string }[]>(page, "bots/list", {});
  await rpc(page, "mcp/assignments/approve", { botId: bot!.id, serverId: server.id });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/mcp/assignments/replace", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  const tool = page.getByRole("checkbox", { name: "notes.write", exact: true });
  await tool.click();
  await expect(tool).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Chief", exact: true })).toBeDisabled();
  release();
  await expect(tool).toBeEnabled();
  await expect(tool).not.toBeChecked();
});

test("managed plugin authorization continues in the same tab when popups are blocked", async ({
  page,
}) => {
  await signup(page, `plugin-popup-${Date.now()}@engaz.test`, "password12", "Plugin Popup");
  await completeOnboarding(page);
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            connectorId: "composio",
            slug: "fakeapp",
            name: "Fake App",
            logo: null,
            connected: false,
            noAuth: false,
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/begin", (route) =>
    route.fulfill({
      json: {
        json: {
          connectionId: "fake-connection",
          authorizationUrl: `${new URL(page.url()).origin}/fake-authorization`,
        },
      },
    }),
  );
  await page.route("**/fake-authorization", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Authorize Fake App</h1>" }),
  );
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Authorize Fake App" })).toBeVisible();
});

test("a connection check refreshes pinned access before showing newly discovered tools", async ({
  page,
}) => {
  await signup(page, `mcp-pin-refresh-${Date.now()}@engaz.test`, "password12", "MCP Pin Refresh");
  await completeOnboarding(page);
  const server = await rpc<McpServer>(page, "mcp/servers/create", {
    slug: "treg",
    name: "Treg",
    transport: "streamable_http",
    endpoint: "https://treg.to/mcp/",
  });
  const [bot] = await rpc<{ id: string }[]>(page, "bots/list", {});
  const assignment = await rpc<BotMcpServer>(page, "mcp/assignments/approve", {
    botId: bot!.id,
    serverId: server.id,
  });
  let checked = false;
  await page.route("**/rpc/mcp/assignments/all", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            ...assignment,
            allowAllTools: !checked,
            allowedTools: checked ? ["notes.write"] : [],
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/mcp/servers/check", (route) => {
    checked = true;
    return route.fulfill({
      json: {
        json: {
          ...server,
          check: {
            ...server.check,
            tools: ["notes.write", "notes.delete"],
          },
        },
      },
    });
  });
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "notes.write", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "notes.delete", exact: true })).not.toBeChecked();
});
