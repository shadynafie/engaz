import { CHAT_BUBBLE } from "@engaz/ui-tokens";

type MessageSpeaker = { role: string; botId?: string };

/** Compare chronological neighbours, even when the rendered list is inverted. */
export function messageSpacing(
  previous: MessageSpeaker | undefined,
  current: MessageSpeaker,
): number {
  if (!previous) return 0;
  const sameSpeaker =
    current.role !== "system" &&
    previous.role === current.role &&
    (current.role !== "bot" || previous.botId === current.botId);
  return sameSpeaker ? CHAT_BUBBLE.sameSpeakerGap : CHAT_BUBBLE.messageGap;
}
