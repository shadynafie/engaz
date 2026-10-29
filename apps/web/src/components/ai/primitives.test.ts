import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatElapsed, LoadingState } from "./primitives";

describe("formatElapsed", () => {
  it("formats only completed whole seconds before a minute", () => {
    expect(formatElapsed(1_000, 1_000)).toBe("0s");
    expect(formatElapsed(1_000, 1_100)).toBe("0s");
    expect(formatElapsed(1_000, 12_500)).toBe("11s");
    expect(formatElapsed(1_000, 60_900)).toBe("59s");
  });

  it("formats elapsed time past a minute", () => {
    expect(formatElapsed(0, 60_000)).toBe("1m 0s");
    expect(formatElapsed(0, 125_700)).toBe("2m 5s");
  });

  it("does not advance a minute before its boundary", () => {
    expect(formatElapsed(0, 59_950)).toBe("59s");
    expect(formatElapsed(0, 60_000)).toBe("1m 0s");
    expect(formatElapsed(0, 119_950)).toBe("1m 59s");
    expect(formatElapsed(0, 120_000)).toBe("2m 0s");
  });

  it("keeps longer work durations in minutes and seconds", () => {
    expect(formatElapsed(0, 3_599_999)).toBe("59m 59s");
    expect(formatElapsed(0, 3_600_000)).toBe("60m 0s");
  });

  it("clamps negative deltas to zero", () => {
    expect(formatElapsed(5_000, 4_000)).toBe("0s");
  });

  it("survives remount-style recomputation from the same start", () => {
    const startedAt = Date.parse("2026-08-25T12:00:00.000Z");
    const later = Date.parse("2026-08-25T12:00:42.300Z");
    expect(formatElapsed(startedAt, later)).toBe("42s");
    expect(formatElapsed(startedAt, later + 60_000)).toBe("1m 42s");
  });
});

describe("LoadingState", () => {
  it("leaves the visible update title to the caller when it supplies an indicator", () => {
    const label = "Updating Team Computer";
    const html = renderToString(
      createElement(
        "button",
        { type: "button" },
        createElement(LoadingState, {
          label,
          indicator: createElement("svg", { "aria-hidden": true }),
        }),
        createElement("span", null, label),
      ),
    );
    expect(html).toContain(`<span class="sr-only">${label}</span>`);
    const visibleHtml = html.replace(`<span class="sr-only">${label}</span>`, "");
    expect(visibleHtml.split(label)).toHaveLength(2);
    expect(visibleHtml).not.toContain("0s");
  });
});
