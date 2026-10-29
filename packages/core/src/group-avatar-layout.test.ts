import { describe, expect, it } from "vitest";
import { groupAvatarLayout } from "./group-avatar-layout.js";

describe("group avatar layout", () => {
  it("places a pair at opposite corners", () => {
    expect(groupAvatarLayout(2, 40)).toEqual({
      miniSize: 26,
      positions: [
        { top: 0, left: 0 },
        { right: 0, bottom: 0 },
      ],
      visibleCount: 2,
      overflowCount: 0,
    });
  });
  it("centres the third member above the lower pair", () => {
    const layout = groupAvatarLayout(3, 40);
    expect(layout.positions[0]!.left! + layout.miniSize / 2).toBe(20);
    expect(layout.visibleCount).toBe(3);
    expect(layout.overflowCount).toBe(0);
  });
  it.each([4, 12])("keeps the overflow count accurate for %i members", (count) => {
    const layout = groupAvatarLayout(count, 40);
    expect(layout.visibleCount + layout.overflowCount).toBe(count);
    expect(layout.visibleCount).toBe(2);
  });
});
