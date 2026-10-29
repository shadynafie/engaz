/** Shared stacking geometry for web and native group avatars. */
export function groupAvatarLayout(memberCount: number, size: number) {
  const pair = memberCount === 2;
  const miniSize = Math.round(size * (pair ? 0.65 : 0.54));
  const positions = pair
    ? [
        { top: 0, left: 0 },
        { right: 0, bottom: 0 },
      ]
    : [
        { top: 0, left: (size - miniSize) / 2 },
        { bottom: 0, left: 0 },
        { right: 0, bottom: 0 },
      ];
  return {
    miniSize,
    positions,
    visibleCount: memberCount > 3 ? 2 : memberCount,
    overflowCount: memberCount > 3 ? memberCount - 2 : 0,
  };
}
