import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

// A new owner's first run on a fresh installation from the published images: sign up, connect
// a model (after the two mistakes people make most), talk to the first agent, give it a plugin,
// and read why a broken plugin cannot be used. The model and MCP server are the fakes in
// fake-services.mjs, reached from Docker the way a local model server is.

const FAKE = `http://host.docker.internal:${process.env.FAKE_SERVICES_PORT ?? 8099}`;

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

test("a new owner goes from sign-up to a working agent with a plugin", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your Engaz" })).toBeVisible();
  await page.getByPlaceholder("Your name").fill("First Owner");
  await page.getByPlaceholder("Your email address").fill("owner@engaz.test");
  await page.getByPlaceholder("Password").fill("fake-password-12");
  await page.getByRole("button", { name: "Create account" }).click();

  // Connect a model.
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "OpenAI-compatible" }).click();
  const serverUrl = page.getByLabel("OpenAI-compatible server URL");
  const apiKey = page.getByLabel("API key", { exact: true });
  const cont = page.getByRole("button", { name: "Continue", exact: true });

  // localhost inside Docker is Engaz itself; the owner is told what to use instead.
  await serverUrl.fill("http://127.0.0.1:8099/v1");
  await page.getByLabel("Model id").fill("fake-model");
  // A key is optional for a model server, so its field starts folded away.
  await page.locator("summary", { hasText: "API key" }).click();
  await apiKey.fill("fake-good-key");
  await cont.click();
  await expect(page.getByText(/use host\.docker\.internal instead of 127\.0\.0\.1/)).toBeVisible({
    timeout: 90_000,
  });
  await shot(page, testInfo, "image-01-model-localhost");

  await serverUrl.fill(`${FAKE}/v1`);
  await page.getByRole("button", { name: "Find models" }).click();
  await expect(page.getByText(/found 1 model/i)).toBeVisible({ timeout: 30_000 });

  // A wrong key is refused before anything is saved.
  await apiKey.fill("fake-wrong-key");
  await cont.click();
  await expect(page.getByText(/rejected this key/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
  await shot(page, testInfo, "image-02-model-rejected");

  await apiKey.fill("fake-good-key");
  await cont.click();

  // The first agent answers.
  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.fill("Say hello.");
  await composer.press("Enter");
  await expect(page.getByText("Hello from the fake model.").first()).toBeVisible({
    timeout: 120_000,
  });
  await shot(page, testInfo, "image-03-first-reply");

  // Give Chief a plugin: an MCP server on this computer.
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-mcp").click();
  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  await page.getByLabel("Server address").fill(`${FAKE}/mcp`);
  await page.getByLabel("Name", { exact: true }).fill("Team notes");
  await expect(page.getByRole("checkbox", { name: "Chief", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Working · 1 tool")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Used by Chief")).toBeVisible();
  await shot(page, testInfo, "image-04-plugin-working");

  // A server that is not running is named as such and not saved.
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page.getByLabel("Server address").fill("http://host.docker.internal:8098/mcp");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/Couldn't reach the server/)).toBeVisible({ timeout: 60_000 });
  await shot(page, testInfo, "image-05-plugin-unreachable");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Team notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close MCP servers" }).click();

  // Chief's settings show the plugin and how much of it Chief may use.
  await page
    .locator("main")
    .getByRole("button", { name: /^Chief/ })
    .click();
  const plugins = page.getByTestId("bot-settings").getByTestId("agent-plugins");
  await expect(plugins.getByText("Team notes", { exact: true })).toBeVisible();
  await expect(plugins.getByText("1 of 1 tool", { exact: true })).toBeVisible();
  await shot(page, testInfo, "image-06-agent-plugins");

  // A reload keeps the owner signed in with the conversation in place.
  await page.reload();
  await expect(page.getByText("Hello from the fake model.").first()).toBeVisible();
});

test("recovery keeps owner sign-in, private agent files and saved credentials", async ({
  page,
}, testInfo) => {
  const installation = process.env.ENGAZ_RECOVERY_INSTALL;
  test.skip(!installation, "Requires an isolated Docker installation.");
  test.setTimeout(900_000);
  if (installation) {
    // The source remains intact; the restore has its own empty directory and project.
    execFileSync(
      "python3",
      [
        "-B",
        "../../infra/compose/image-lifecycle-check.py",
        "--install-dir",
        installation,
        "--rehearse-update",
        "--target",
        path.join(path.dirname(installation), `${path.basename(installation)}-recovered`),
      ],
      { stdio: "inherit", timeout: 600_000 },
    );
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByPlaceholder("Your email address").fill("owner@engaz.test");
    await page.getByPlaceholder("Password").fill("fake-password-12");
    await page.getByRole("button", { name: "Continue with email", exact: true }).click();
    const restoredComposer = page.getByRole("combobox", { name: "Message Chief" });
    await expect(restoredComposer).toBeVisible({ timeout: 60_000 });
    const replies = await page.getByText("Hello from the fake model.", { exact: true }).count();
    await restoredComposer.fill("Say hello after restoring the backup.");
    await restoredComposer.press("Enter");
    // The fake refuses requests without the saved key: a new answer proves decryption.
    await expect(page.getByText("Hello from the fake model.", { exact: true })).toHaveCount(
      replies + 1,
      { timeout: 120_000 },
    );
    await shot(page, testInfo, "image-07-restored-owner-and-credential");
  }
});
