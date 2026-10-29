/** Chat surface geometry and body typography shared by web, desktop, and native. */
export const CHAT_BUBBLE = {
  fontSize: 15,
  lineHeight: 23,
  radius: 20,
  messageGap: 24,
  sameSpeakerGap: 8,
  paddingHorizontal: 18,
  paddingVertical: 12,
} as const;

/** Space the activity label clear of the comet, with matching text on each platform. */
export const CHAT_ACTIVITY = { gap: 12, fontSize: 13.5, timerFontSize: 12 } as const;
