import { CHAT_BUBBLE } from "@engaz/ui-tokens";
import { describe, expect, it } from "vitest";
import { messageSpacing } from "./message-spacing";

describe("messageSpacing", () => {
  it("adds no leading gap before the first message", () => {
    expect(messageSpacing(undefined, { role: "user" })).toBe(0);
  });

  it("groups consecutive messages from the same person or agent", () => {
    expect(messageSpacing({ role: "user" }, { role: "user" })).toBe(CHAT_BUBBLE.sameSpeakerGap);
    expect(messageSpacing({ role: "bot", botId: "chief" }, { role: "bot", botId: "chief" })).toBe(
      CHAT_BUBBLE.sameSpeakerGap,
    );
  });

  it("separates changes of speaker, including agents within the same group", () => {
    expect(messageSpacing({ role: "user" }, { role: "bot", botId: "chief" })).toBe(
      CHAT_BUBBLE.messageGap,
    );
    expect(messageSpacing({ role: "bot", botId: "chief" }, { role: "user" })).toBe(
      CHAT_BUBBLE.messageGap,
    );
    expect(messageSpacing({ role: "bot", botId: "chief" }, { role: "bot", botId: "scout" })).toBe(
      CHAT_BUBBLE.messageGap,
    );
  });

  it("keeps system events apart instead of grouping them as a speaker", () => {
    expect(messageSpacing({ role: "system" }, { role: "system" })).toBe(CHAT_BUBBLE.messageGap);
    expect(messageSpacing({ role: "system" }, { role: "bot" })).toBe(CHAT_BUBBLE.messageGap);
    expect(messageSpacing({ role: "user" }, { role: "system" })).toBe(CHAT_BUBBLE.messageGap);
  });
});
