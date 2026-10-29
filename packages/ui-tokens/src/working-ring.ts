/** Shared comet artwork and motion for web, Electron and native avatars. */
export const WORKING_RING = {
  viewBox: "0 0 48 48",
  path: "M24 2 A22 22 0 0 1 43.05 35",
  startX: 24,
  startY: 2,
  gradientStops: [
    { offset: 0, opacity: 0 },
    { offset: 0.5, opacity: 0.25 },
    { offset: 1, opacity: 1 },
  ],
  headX: 43.05,
  headY: 35,
  headRadius: 1.3,
  strokeWidth: 2,
  durationMs: 1600,
  blur: 1.5,
  gap: 4,
} as const;

/** Keep the comet's inner edge clear of the avatar at every display size. */
export function workingRingLayout(avatarSize: number) {
  const size = ((avatarSize / 2 + WORKING_RING.gap) * 48) / (22 - WORKING_RING.headRadius);
  return { size, inset: (avatarSize - size) / 2 };
}
