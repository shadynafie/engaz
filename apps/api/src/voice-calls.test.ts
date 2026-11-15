import type { Actor } from "@engaz/contracts";
import { describe, expect, it, vi } from "vitest";
import { saveVoiceCall } from "./voice-calls.js";

const actor = { userId: "owner", spaceId: "space" } as Actor;
const input = {
  botId: "bot",
  callId: "c6365a88-42d9-4e6b-9afd-e9d434941a2a",
  startedAt: "2026-01-01T12:00:00.000Z",
  endedAt: "2026-01-01T12:01:00.000Z",
  transcript: [{ role: "user" as const, text: "Check the report" }],
};

describe("saveVoiceCall", () => {
  it("checks ownership before reading or writing any artifact", async () => {
    const deps = {
      prisma: {
        bot: { findFirst: vi.fn().mockResolvedValue(null) },
        artifact: { findFirst: vi.fn() },
      },
      artifacts: { put: vi.fn() },
    };
    await expect(saveVoiceCall(deps as never, actor, input)).rejects.toThrow();
    expect(deps.prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot", userId: "owner", spaceId: "space" } }),
    );
    expect(deps.prisma.artifact.findFirst).not.toHaveBeenCalled();
    expect(deps.artifacts.put).not.toHaveBeenCalled();
  });
  it("returns an existing identical record without another artifact write", async () => {
    const deps = {
      prisma: {
        bot: { findFirst: vi.fn().mockResolvedValue({ name: "Chief" }) },
        artifact: { findFirst: vi.fn().mockResolvedValue({ id: "saved" }) },
      },
      artifacts: { put: vi.fn() },
    };
    await expect(saveVoiceCall(deps as never, actor, input)).resolves.toEqual({ id: "saved" });
    expect(deps.prisma.artifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ botId: "bot", userId: "owner", spaceId: "space" }),
      }),
    );
    expect(deps.artifacts.put).not.toHaveBeenCalled();
  });
});
