import { ChatBubble } from "@engaz/chat-ui/bubble/web";
import { CHAT_BUBBLE } from "@engaz/ui-tokens";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("shared chat bubble", () => {
  it("keeps quote and accessibility attributes on the styled user surface", () => {
    const html = renderToStaticMarkup(
      <ChatBubble user data-quote-message-id="message-1" aria-label="Your message">
        Launch notes
      </ChatBubble>,
    );
    expect(html).toContain('data-quote-message-id="message-1"');
    expect(html).toContain('aria-label="Your message"');
    expect(html).toContain("bg-chat-user text-chat-user-foreground");
    expect(html).toContain(`border-radius:${CHAT_BUBBLE.radius}px`);
    expect(html).toContain(`padding-inline:${CHAT_BUBBLE.paddingHorizontal}px`);
    expect(html).toContain("Launch notes");
  });

  it("places streamed agent content directly on the page", () => {
    const html = renderToStaticMarkup(
      <ChatBubble data-testid="message-bot-bubble" className="space-y-2.5">
        <span>Preparing the release</span>
      </ChatBubble>,
    );
    expect(html).toContain('data-testid="message-bot-bubble"');
    expect(html).toContain("text-foreground space-y-2.5");
    expect(html).not.toContain("bg-muted");
    expect(html).toContain("padding-inline:0");
    expect(html).toContain(`line-height:${CHAT_BUBBLE.lineHeight}px`);
    expect(html).toContain("<span>Preparing the release</span>");
  });
});
