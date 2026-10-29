import { describe, expect, it } from "vitest";
import { WORKING_RING, workingRingLayout } from "./working-ring.js";

describe("working comet layout", () => {
  it.each([16, 22, 28, 36, 54, 84, 120])(
    "centres the comet with a clear gap at %ipx",
    (avatarSize) => {
      const layout = workingRingLayout(avatarSize);
      expect(layout.inset + layout.size / 2).toBeCloseTo(avatarSize / 2);
      const innerEdge = ((22 - WORKING_RING.headRadius) * layout.size) / 48;
      expect(innerEdge - avatarSize / 2).toBeCloseTo(WORKING_RING.gap);
    },
  );
});
