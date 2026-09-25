import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

// The screens changed while building first run, plugins, and skills, checked the same way:
// light and dark, a desktop and a phone width, and reachable, named controls.

const viewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "phone", width: 390, height: 844 },
] as const;

type Finding = { screen: string; where: string; problem: string };

async function audit(page: Page, testInfo: TestInfo, screen: string, scope: () => Locator) {
  const findings: Finding[] = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // The app follows the system theme through a listener; wait until it has switched.
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect(scope()).toBeVisible();
      const where = `${viewport.label} ${colorScheme}`;
      const problems = await scope().evaluate((root) => {
        const out: string[] = [];
        const width = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > width + 1) {
          out.push(
            `page scrolls sideways (${document.documentElement.scrollWidth}px > ${width}px)`,
          );
        }
        const visible = (el: Element) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (
            rect.width === 0 ||
            rect.height === 0 ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
          // A collapsed section clips its content to nothing.
          for (let node = el.parentElement; node; node = node.parentElement) {
            if (getComputedStyle(node).overflowY === "visible") continue;
            const box = node.getBoundingClientRect();
            if (rect.bottom <= box.top || rect.top >= box.bottom) return false;
          }
          return true;
        };
        const clipped = (el: Element) => {
          for (
            let node = el.parentElement;
            node && node !== document.body;
            node = node.parentElement
          ) {
            const overflow = getComputedStyle(node).overflowX;
            if (overflow !== "visible") return true;
          }
          return false;
        };
        const describe = (el: Element) => {
          const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
          const testId = el.closest("[data-testid]")?.getAttribute("data-testid");
          const attrs = ["role", "type", "aria-label", "placeholder"]
            .filter((name) => el.hasAttribute(name))
            .map((name) => ` ${name}=${el.getAttribute(name)}`)
            .join("");
          return `<${el.tagName.toLowerCase()}${attrs}> "${text}"${testId ? ` in ${testId}` : ""}`;
        };
        const controls = root.querySelectorAll(
          "button, a[href], input:not([type=hidden]), textarea, select, [role=switch], [role=checkbox], [role=tab], [role=menuitem], [role=combobox]",
        );
        for (const el of controls) {
          // Base UI pairs each switch and checkbox with a hidden native input for forms.
          if (!visible(el) || el.closest("[aria-hidden=true]")) continue;
          const rect = el.getBoundingClientRect();
          if ((rect.right > width + 1 || rect.left < -1) && !clipped(el)) {
            out.push(`off screen: ${describe(el)}`);
          }
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (x > 0 && x < width && y > 0 && y < window.innerHeight) {
            // Content may scroll under the screen's own sticky bars, but nothing else may cover it.
            const top = document.elementFromPoint(x, y);
            if (top && !root.contains(top) && !top.contains(el)) {
              out.push(`covered by ${describe(top)}: ${describe(el)}`);
            }
          }
          const labelledBy = el
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          const labels =
            "labels" in el
              ? Array.from((el as HTMLInputElement).labels ?? [])
                  .map((label) => label.textContent ?? "")
                  .join(" ")
              : "";
          const name = [
            el.getAttribute("aria-label"),
            labelledBy,
            labels,
            el.getAttribute("title"),
            el.getAttribute("placeholder"),
            el.textContent,
            ...Array.from(el.querySelectorAll("img[alt]")).map((img) => img.getAttribute("alt")),
          ]
            .join("")
            .trim();
          if (!name) out.push(`no accessible name: ${describe(el)}`);
        }
        // Truncated text squeezed to a few characters says nothing.
        for (const el of root.querySelectorAll("*")) {
          if (!visible(el) || el.closest("[aria-hidden=true]")) continue;
          const style = getComputedStyle(el);
          if (style.textOverflow !== "ellipsis" || el.scrollWidth <= el.clientWidth) continue;
          if (el.clientWidth < 48)
            out.push(`text squeezed to ${el.clientWidth}px: ${describe(el)}`);
        }
        return out;
      });
      for (const problem of new Set(problems)) findings.push({ screen, where, problem });
      await captureScreenshot(page, testInfo, `quality-${screen}-${viewport.label}-${colorScheme}`);
    }
  }

  // Keyboard: every stop Tab reaches is on screen and visibly focused.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await scope().evaluate((root) => {
    (document.activeElement as HTMLElement | null)?.blur();
    root.setAttribute("tabindex", "-1");
    (root as HTMLElement).focus();
    root.removeAttribute("tabindex");
  });
  for (let step = 0; step < 25; step++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Base UI's guards hand focus back into an open dialog.
      if (el.hasAttribute("data-base-ui-focus-guard")) return { guard: true } as const;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const ring =
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
          ? true
          : style.boxShadow !== "none";
      const onScreen =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        rect.top < innerHeight;
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
      return { tag: el.tagName.toLowerCase(), text, ring, onScreen };
    });
    if (!stop) break;
    if ("guard" in stop) continue;
    if (!stop.onScreen) {
      findings.push({
        screen,
        where: "keyboard",
        problem: `Tab reaches a hidden <${stop.tag}> "${stop.text}"`,
      });
    } else if (!stop.ring) {
      findings.push({
        screen,
        where: "keyboard",
        problem: `no visible focus on <${stop.tag}> "${stop.text}"`,
      });
    }
  }
  return findings;
}

function report(testInfo: TestInfo, findings: Finding[]) {
  const unique = [
    ...new Map(findings.map((f) => [`${f.screen}|${f.where}|${f.problem}`, f])).values(),
  ];
  if (unique.length) {
    testInfo.annotations.push({
      type: "ui-quality",
      description: unique.map((f) => `${f.screen} [${f.where}] ${f.problem}`).join("\n"),
    });
    console.log(unique.map((f) => `${f.screen} [${f.where}] ${f.problem}`).join("\n"));
  }
  expect.soft(unique).toEqual([]);
}

test("sign-up screens hold up in light, dark, phone width, and keyboard", async ({
  page,
}, testInfo) => {
  const findings: Finding[] = [];
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your Engaz" })).toBeVisible();
  findings.push(...(await audit(page, testInfo, "sign-up", () => page.locator("body"))));

  await page.route("**/api/auth/capabilities", (route) =>
    route.fulfill({ json: { passwordReset: false, resetUrl: null, invitationRequired: true } }),
  );
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Invitation needed" })).toBeVisible();
  findings.push(...(await audit(page, testInfo, "invitation-needed", () => page.locator("body"))));
  report(testInfo, findings);
});

test("the onboarding model step holds up in light, dark, phone width, and keyboard", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({ response, json: { json: { ...body.json, needsModel: true } } });
  });
  await signup(page, `quality-model-${Date.now()}@engaz.test`, "password12", "Quality Model");
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 20_000,
  });
  report(testInfo, await audit(page, testInfo, "onboarding-model", () => page.locator("body")));
});

test("settings, plugins, and skills hold up in light, dark, phone width, and keyboard", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { json: { ...body.json, me: { ...body.json.me, isDeploymentOwner: true } } },
    });
  });
  await page.route("**/rpc/invites/list", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            id: "invite-0",
            createdAt: "2026-09-24T10:00:00.000Z",
            expiresAt: "2026-10-01T10:00:00.000Z",
            usedAt: "2026-09-24T12:00:00.000Z",
            usedByEmail: "friend@engaz.test",
          },
        ],
      },
    }),
  );
  await signup(page, `quality-owner-${Date.now()}@engaz.test`, "password12", "Quality Owner");
  await completeOnboarding(page);
  const findings: Finding[] = [];

  // Settings → People
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-people").click();
  await expect(page.getByRole("button", { name: "Create invitation link" })).toBeVisible();
  findings.push(
    ...(await audit(page, testInfo, "settings-people", () => page.getByTestId("user-settings"))),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("user-settings")).toBeHidden();

  // Integrations → MCP servers
  await page.getByText("Integrations", { exact: true }).click();
  await expect(page.getByTestId("integrations-mcp")).toBeVisible();
  findings.push(...(await audit(page, testInfo, "integrations", () => page.getByRole("dialog"))));
  await page.getByTestId("integrations-mcp").click();
  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  findings.push(...(await audit(page, testInfo, "mcp-servers", () => page.getByRole("dialog"))));

  // Agent settings: plugins and skills, then the skill editor.
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await page
    .locator("main")
    .getByRole("button", { name: /^Chief/ })
    .click();
  const settings = () => page.getByTestId("bot-settings");
  await expect(settings().getByTestId("agent-skills")).toBeVisible();
  findings.push(...(await audit(page, testInfo, "agent-settings", settings)));
  await settings().getByRole("button", { name: "New skill", exact: true }).click();
  await expect(settings().getByLabel("Instructions", { exact: true })).toBeVisible();
  findings.push(...(await audit(page, testInfo, "skill-editor", settings)));
  report(testInfo, findings);
});
