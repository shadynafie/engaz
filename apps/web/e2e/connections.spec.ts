import type { Connection } from "@engaz/contracts";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openConnections, rpc, signup } from "./helpers";

async function directFixture(page: Page) {
  let approved = false;
  let rows: Connection[] = [];
  const assignments: unknown[] = [];
  const polls: unknown[] = [];
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            connectorId: "direct",
            slug: "github",
            name: "GitHub",
            logo: null,
            connected: rows.some((row) => row.status === "connected"),
            noAuth: false,
            available: true,
            setupRequired: false,
          },
          {
            connectorId: "direct",
            slug: "slack",
            name: "Slack",
            logo: null,
            connected: false,
            noAuth: false,
            available: false,
            setupRequired: true,
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/list", (route) => route.fulfill({ json: { json: rows } }));
  await page.route("**/rpc/connections/begin", (route) => {
    rows = [
      {
        id: "direct-fixture",
        connectorId: "direct",
        provider: "github",
        displayName: "GitHub",
        status: "pending",
        capabilities: ["Read repositories"],
        accountLabel: null,
        checkedAt: null,
        agentIds: [],
        createdAt: "2026-01-01T12:00:00Z",
      },
    ];
    return route.fulfill({
      json: {
        json: {
          connectionId: "direct-fixture",
          authorizationId: "fixture-workflow",
          authorizationUrl: null,
          userCode: "ABCD-EFGH",
          verificationUri: "https://device.example.test",
          pollIntervalSeconds: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
  });
  await page.route("**/rpc/connections/complete", (route) => {
    polls.push(route.request().postDataJSON().json);
    if (approved)
      rows = rows.map((row) => ({
        ...row,
        status: "connected",
        accountLabel: "demo-account",
        checkedAt: "2026-01-01T12:01:00Z",
      }));
    return route.fulfill({ json: { json: rows[0] } });
  });
  await page.route("**/rpc/connections/tools", (route) =>
    route.fulfill({
      json: { json: [{ name: "github_list_repositories", description: "Read repositories" }] },
    }),
  );
  await page.route("**/rpc/connections/setAgents", (route) => {
    const input = route.request().postDataJSON().json;
    assignments.push(input);
    rows = rows.map((row) => ({ ...row, agentIds: input.botIds }));
    return route.fulfill({ json: { json: rows[0] } });
  });
  return {
    approve: () => {
      approved = true;
    },
    assignments,
    polls,
  };
}

test("Connections lives in Settings with apps first and Advanced collapsed", async ({
  page,
}, testInfo) => {
  await signup(
    page,
    `connections-layout-${Date.now()}@engaz.test`,
    "password12",
    "Connections fixture",
  );
  await completeOnboarding(page);
  await directFixture(page);
  await expect(
    page.locator("aside").first().getByRole("button", { name: "Integrations", exact: true }),
  ).toHaveCount(0);
  const settings = await openConnections(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect(settings.getByText("GitHub", { exact: true })).toBeVisible();
      await expect(settings.getByText("Slack", { exact: true })).toHaveCount(0);
      await expect(settings.getByTestId("integrations-mcp")).toBeHidden();
      await expect(settings.getByRole("button", { name: "Add OpenAPI", exact: true })).toBeHidden();
      await expect(settings.getByText("Composio", { exact: true })).toHaveCount(0);
      await expect(settings.getByText("Pipedream", { exact: true })).toHaveCount(0);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await captureScreenshot(page, testInfo, `connections-${colorScheme}-${width}`);
    }
  }
  await settings.getByTestId("integrations-advanced").locator("summary").first().click();
  await expect(settings.getByTestId("integrations-mcp")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Add OpenAPI", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Add Executor", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Add Treg", exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "connections-advanced");
  await settings.getByTestId("integrations-mcp").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Add MCP server", exact: true })).toBeVisible();
});

test("direct sign-in shows its code, waits for verification, then grants a chosen agent", async ({
  page,
}, testInfo) => {
  await signup(page, `connections-direct-${Date.now()}@engaz.test`, "password12", "Direct fixture");
  await completeOnboarding(page);
  const fixture = await directFixture(page);
  const [bot] = await rpc<{ id: string }[]>(page, "bots/list", {});
  const settings = await openConnections(page);
  await settings.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(settings.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Connected", exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "connections-device-sign-in");
  fixture.approve();
  await settings.getByRole("button", { name: "Connected", exact: true }).click();
  await expect(settings.getByText("demo-account", { exact: true })).toBeVisible();
  await settings.getByTestId("connection-accounts").locator("summary").click();
  const chief = settings.getByRole("checkbox", { name: "Chief", exact: true });
  await expect(chief).not.toBeChecked();
  await chief.click();
  await expect(chief).toBeChecked();
  expect(fixture.assignments).toEqual([{ connectionId: "direct-fixture", botIds: [bot!.id] }]);
  expect(fixture.polls).toContainEqual({
    connectionId: "direct-fixture",
    authorizationId: "fixture-workflow",
  });
  await captureScreenshot(page, testInfo, "connections-account-agent-access");
});
