import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("the owner creates an invitation link from Settings", async ({ page }, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { json: { ...body.json, me: { ...body.json.me, isDeploymentOwner: true } } },
    });
  });
  const invite = {
    id: "invite-1",
    createdAt: "2026-09-25T10:00:00.000Z",
    expiresAt: "2026-10-02T10:00:00.000Z",
    usedAt: null,
    usedByEmail: null,
  };
  await page.route("**/rpc/invites/list", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            ...invite,
            id: "invite-0",
            usedAt: "2026-09-24T10:00:00.000Z",
            usedByEmail: "friend@engaz.test",
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/invites/create", (route) =>
    route.fulfill({
      json: {
        json: { invite, url: "https://engaz.example.test/sign-up?invite=fake-invite-token" },
      },
    }),
  );
  await signup(page, `invites-owner-${Date.now()}@engaz.test`, "password12", "Invite Owner");
  await completeOnboarding(page);
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-people").click();
  await expect(page.getByText("Used by friend@engaz.test")).toBeVisible();
  await page.getByRole("button", { name: "Create invitation link", exact: true }).click();
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(
    "https://engaz.example.test/sign-up?invite=fake-invite-token",
  );
  await expect(page.getByRole("button", { name: "Revoke invitation" })).toBeVisible();
  await captureScreenshot(page, testInfo, "settings-people-invite");
});

test("sign-up asks for an invitation once the owner exists", async ({ page }, testInfo) => {
  await page.route("**/api/auth/capabilities", (route) =>
    route.fulfill({
      json: { passwordReset: false, resetUrl: null, invitationRequired: true },
    }),
  );
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Invitation needed" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "signup-invitation-needed");
  await page.goto("/sign-up?invite=fake-invite-token");
  await expect(page.getByRole("heading", { name: "Create your Engaz" })).toBeVisible();
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
});
