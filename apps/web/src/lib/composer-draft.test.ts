import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearChatDrafts,
  emptyComposerDraft,
  readChatSendAttempt,
  readComposerDraft,
  saveChatSendAttempt,
  saveComposerDraft,
} from "./composer-draft";

beforeEach(() => {
  const data: Record<string, string> = {};
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

test("drafts retain text, skill and mentions and remove empty drafts", () => {
  const draft = {
    text: "unfinished",
    reply: null,
    skill: {
      id: "skill",
      name: "Review",
      description: "Review work",
      source: "user" as const,
      readOnly: false,
      botIds: ["bot"],
    },
    mentions: [{ kind: "bot" as const, id: "bot", name: "Chief" }],
  };
  saveComposerDraft("draft", draft);
  expect(readComposerDraft("draft")).toEqual(draft);
  saveComposerDraft("draft", emptyComposerDraft());
  expect(sessionStorage.getItem("draft")).toBeNull();
});

test("corrupt storage does not break the composer", () => {
  sessionStorage.setItem("draft", "{");
  expect(readComposerDraft("draft")).toEqual(emptyComposerDraft());
  sessionStorage.setItem(
    "draft",
    JSON.stringify({
      text: "keep text",
      skill: {},
      mentions: [null, { kind: "bot", id: "bot", name: 4 }],
    }),
  );
  expect(readComposerDraft("draft")).toEqual({
    text: "keep text",
    skill: null,
    mentions: [],
    reply: null,
  });
  sessionStorage.setItem(
    "send",
    JSON.stringify({ signature: "signature", nonce: "nonce", artifacts: [["id", null]] }),
  );
  expect(readChatSendAttempt("send")).toBeUndefined();
});

test("retry nonce and completed uploads survive a reload", () => {
  const attempt = {
    signature: "signature",
    nonce: "nonce",
    artifacts: new Map([["file", "artifact"]]),
  };
  saveChatSendAttempt("send", attempt);
  expect(readChatSendAttempt("send")).toEqual(attempt);
  saveChatSendAttempt("send", null);
  expect(readChatSendAttempt("send")).toBeUndefined();
});

test("unavailable browser storage is harmless", () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  expect(readComposerDraft("draft")).toEqual(emptyComposerDraft());
  expect(readChatSendAttempt("send")).toBeUndefined();
  expect(() =>
    saveComposerDraft("draft", { ...emptyComposerDraft(), text: "still held in memory" }),
  ).not.toThrow();
});

test("logout removes only the current user's chat storage", () => {
  // Native Storage exposes each saved key as an own property.
  vi.stubGlobal("sessionStorage", {
    "engaz:chat-draft:owner:bot": "private draft",
    "engaz:chat-send:owner:bot": "private send",
    "engaz:chat-draft:other:bot": "other draft",
    removeItem(key: string) {
      delete (this as Record<string, unknown>)[key];
    },
  });
  clearChatDrafts("owner");
  expect(Object.keys(sessionStorage)).not.toContain("engaz:chat-draft:owner:bot");
  expect(Object.keys(sessionStorage)).not.toContain("engaz:chat-send:owner:bot");
  expect(Object.keys(sessionStorage)).toContain("engaz:chat-draft:other:bot");
});
