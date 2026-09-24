import type { CapabilityInstall } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("tool sources show whether they work and which agents use them", async ({
  page,
}, testInfo) => {
  await signup(page, `tool-sources-${Date.now()}@engaz.test`, "password12", "Tool Sources");
  await completeOnboarding(page);

  let source: CapabilityInstall = {
    id: "source-1",
    kind: "api",
    name: "Orders API",
    source: "https://api.example.test/v1",
    version: "1.0.0",
    digest: null,
    secretConfigured: true,
    config: {},
    check: {
      status: "failing",
      message: "The server rejected the access token.",
      checkedAt: "2026-09-25T10:00:00.000Z",
    },
    agentIds: null,
    createdAt: "2026-09-25T10:00:00.000Z",
  };
  const agentUpdates: unknown[] = [];
  await page
    .context()
    .route("**/rpc/capabilities/list", (route) => route.fulfill({ json: { json: [source] } }));
  await page.context().route("**/rpc/capabilities/check", (route) => {
    source = { ...source, check: { ...source.check, status: "working", message: null } };
    return route.fulfill({ json: { json: source } });
  });
  await page.context().route("**/rpc/capabilities/setAgents", (route) => {
    const input = route.request().postDataJSON().json;
    agentUpdates.push(input);
    source = { ...source, agentIds: input.agentIds };
    return route.fulfill({ json: { json: source } });
  });

  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-advanced").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("The server rejected the access token.")).toBeVisible();
  await captureScreenshot(page, testInfo, "tool-source-needs-attention");

  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible();

  const chief = page.getByRole("button", { name: "Chief", exact: true });
  await expect(chief).toHaveAttribute("aria-pressed", "true");
  await chief.click();
  await expect.poll(() => agentUpdates).toEqual([{ id: "source-1", agentIds: [] }]);
  await expect(chief).toHaveAttribute("aria-pressed", "false");
  await captureScreenshot(page, testInfo, "tool-source-agent-access");
});
