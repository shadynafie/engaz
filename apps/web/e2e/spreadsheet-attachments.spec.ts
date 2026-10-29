// Adapted from Rakazo PR #2748 (Apache-2.0); spreadsheet fixtures share that source.
// https://github.com/elie222/rakazo/pull/2748
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Artifact, ArtifactWithContent } from "@engaz/contracts";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("Excel files can be attached and uploaded without losing their bytes", async ({
  page,
}, testInfo) => {
  await signup(page, `spreadsheet-${Date.now()}@engaz.test`, "password12", "Sheet Reader");
  await completeOnboarding(page);
  const composer = page.getByRole("combobox", { name: /Message/ });
  await expect(composer).toBeVisible();
  const files = [
    { name: "statement.xls", mimeType: "application/octet-stream" },
    { name: "statement.xlsx", mimeType: "" },
  ].map((file) => ({
    ...file,
    buffer: readFileSync(path.join(import.meta.dirname, "fixtures", file.name)),
  }));
  const picker = page.locator('input[type="file"]');
  await expect(picker).toHaveAttribute("accept", /\.xls(?:,|$)/);
  await expect(picker).toHaveAttribute("accept", /\.xlsx(?:,|$)/);
  await picker.setInputFiles(files);
  for (const file of files) {
    await expect(
      page.getByRole("button", { name: `Remove ${file.name}`, exact: true }),
    ).toBeVisible();
  }
  await captureScreenshot(page, testInfo, "excel-attachments-ready");
  await composer.fill("Here are the current statements");
  await composer.press("Enter");
  await expect(
    page.getByTestId("transcript").getByText("Here are the current statements", { exact: true }),
  ).toBeVisible();
  const artifacts = await rpc<Artifact[]>(page, "artifacts/list", { botId: activeBotId(page) });
  for (const [index, file] of files.entries()) {
    const artifact = artifacts.find((item) => item.name === file.name);
    expect(artifact).toBeDefined();
    expect(artifact?.mimeType).toBe(
      [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ][index],
    );
    const stored = await rpc<ArtifactWithContent>(page, "artifacts/get", {
      botId: activeBotId(page),
      artifactId: artifact!.id,
    });
    expect(stored.contentBase64).toBe(file.buffer.toString("base64"));
  }
});
