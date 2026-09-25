import { defineConfig, devices } from "@playwright/test";

// Runs against an installation started from the published images; see
// .github/workflows/published-image-boot.yml. Nothing is started here.
export default defineConfig({
  testDir: "./e2e-image",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [...(process.env.CI ? ([["github"]] as const) : []), ["list"] as const],
  outputDir: "../../test-results/image",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:7791",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
