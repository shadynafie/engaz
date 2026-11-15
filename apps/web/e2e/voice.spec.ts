import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

test("voice settings connect a key, speak a reply, and open a call", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    class SpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      start() {
        (window as unknown as { callRecognition: SpeechRecognition }).callRecognition = this;
      }
      stop() {}
      abort() {}
    }
    (window as unknown as { SpeechRecognition: typeof SpeechRecognition }).SpeechRecognition =
      SpeechRecognition;
  });
  const stamp = Date.now();
  const userName = `Voice ${stamp}`;
  await signup(page, `voice-${stamp}@engaz.test`, "password12", userName);
  await completeOnboarding(page);

  await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Voice", exact: true }),
  ).toHaveCount(1);
  await captureScreenshot(page, testInfo, "voice-composer");
  await page
    .getByTestId("composer-bar")
    .getByRole("button", { name: "Voice", exact: true })
    .click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "voice-settings");
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);

  const preparedOff = await rpc<{ ready: boolean }>(page, "voice/prepare", {
    text: "Hello there.",
  });
  expect(preparedOff.ready).toBe(false);

  await openUserSettings(page, "voice");
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByRole("button", { name: /Scripted/ }).click();
  const apiKeyInput = page.getByPlaceholder(/Paste your API key/);
  await expect(apiKeyInput).toHaveAttribute("autocomplete", "new-password");
  await apiKeyInput.fill("fake-scripted-voice-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings-connected");

  const spoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "Hear a sample" }).click();
  const clip = await spoken;
  expect(clip.headers()["content-type"]).toContain("audio/mpeg");

  const credentials = await rpc<Array<{ hasKey: boolean; provider: string }>>(
    page,
    "voice/credentials",
    {},
  );
  expect(credentials).toEqual([expect.objectContaining({ hasKey: true, provider: "scripted" })]);
  expect(JSON.stringify(credentials)).not.toContain("fake-scripted-voice-key");

  await page.getByRole("button", { name: "Close voice settings" }).click();

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("say hello");
  await page.keyboard.press("Enter");
  // A reply can render more than one text bubble; speak the latest one.
  const speakReply = page.getByRole("button", { name: "Speak this reply" }).last();
  await expect(speakReply).toBeVisible({
    timeout: 30_000,
  });

  const replySpoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await speakReply.click();
  await replySpoken;

  await openUserSettings(page, "voice");
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close voice settings" }).click();

  await page
    .getByTestId("composer-bar")
    .getByRole("button", { name: "Voice", exact: true })
    .click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hang up" })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-call");
  let resumeSend!: () => void;
  const sendGate = new Promise<void>((resolve) => {
    resumeSend = resolve;
  });
  let finishSend!: () => void;
  const sendHandlerDone = new Promise<void>((resolve) => {
    finishSend = resolve;
  });
  const delaySend = async (route: Route) => {
    try {
      await sendGate;
      await route.continue();
    } finally {
      finishSend();
    }
  };
  await page.route("**/rpc/threads/send", delaySend);
  const sending = page.waitForRequest("**/rpc/threads/send");
  await page.evaluate(() => {
    const recognition = (
      window as unknown as { callRecognition: { onresult: (event: unknown) => void } }
    ).callRecognition;
    recognition.onresult({
      resultIndex: 0,
      results: [[{ transcript: "voice call record check" }]],
    });
  });
  await expect(
    page.getByTestId("call-view").getByText("voice call record check", { exact: true }),
  ).toBeVisible();
  // Hang up while submission is held: the spoken words must already be in the saved call.
  await sending;
  const callBots = await rpc<Array<{ id: string }>>(page, "bots/list", {});
  try {
    await page.getByRole("button", { name: "Hang up" }).click();
    await expect(page.getByTestId("call-view")).toHaveCount(0);
    const callFiles = await rpc<Array<{ id: string; name: string }>>(page, "artifacts/list", {
      botId: callBots[0]!.id,
    });
    const callRecord = callFiles.find((file) => file.name.startsWith("voice-call-"));
    expect(callRecord).toBeDefined();
    const savedCall = await rpc<{ contentBase64: string }>(page, "artifacts/get", {
      botId: callBots[0]!.id,
      artifactId: callRecord!.id,
    });
    const markdown = Buffer.from(savedCall.contentBase64, "base64").toString("utf8");
    expect(markdown).toContain("voice call record check");
    expect(markdown).toContain("## Summary");
    expect(markdown).not.toContain("fake-scripted-voice-key");
  } finally {
    resumeSend();
    await sendHandlerDone;
    await page.unroute("**/rpc/threads/send", delaySend);
  }
  // Finishing the call does not cancel the request already handed to the same agent.
  await expect
    .poll(async () => {
      const snapshot = await rpc<{
        messages: Array<{ blocks: Array<{ kind: string; text?: string }> }>;
      }>(page, "threads/get", { botId: callBots[0]!.id });
      return snapshot.messages.some((message) =>
        message.blocks.some(
          (block) => block.kind === "text" && block.text === "voice call record check",
        ),
      );
    })
    .toBe(true);

  await openUserSettings(page, "voice");
  const settings = page.getByTestId("voice-settings");
  await settings.getByPlaceholder(/Paste a replacement key/).fill("leftover-voice-key");
  await settings.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(rpc<Array<{ provider: string }>>(page, "voice/credentials", {})).resolves.toEqual(
    [],
  );
});
