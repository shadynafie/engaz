import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveBotGlyph, CollaborationMarker } from "./CollaborationMarker";

describe("collaboration transcript markers", () => {
  afterEach(() => vi.useRealTimers());
  it("shows a left-aligned peer event with its avatar and full label", () => {
    const html = renderToString(
      <CollaborationMarker
        ariaLabel="Message from Research"
        color="#14B8A6"
        identity="research"
        label="Message from Research"
        onClick={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="peer-receipt-chip"');
    expect(html).toContain('aria-label="Message from Research"');
    expect(html).toContain('class="flex justify-start"');
    expect(html).toContain('class="inline-flex max-w-full');
    expect(html).toContain('class="truncate"');
    expect(html).toContain("engaz-bot-avatar");
    expect(html).toContain("Message from Research");
    expect(html).not.toContain("{peer}");
  });

  it("shows the working label and elapsed time beside the active bot glyph", () => {
    vi.useFakeTimers();
    vi.setSystemTime(12_500);
    const html = renderToString(
      <ActiveBotGlyph
        bots={[{ botId: "research", color: "#14B8A6", status: "running" }]}
        label="Research is working"
        startedAt={1_000}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Research is working</span>");
    expect(html).not.toContain("sr-only");
    expect(html).toContain("11s");
    expect(html).toContain('data-working="true"');
    expect(html).toContain("engaz-bot-avatar-ring");
  });
});
