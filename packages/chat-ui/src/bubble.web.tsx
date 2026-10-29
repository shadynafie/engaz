import { CHAT_BUBBLE } from "@engaz/ui-tokens";
import type { ComponentPropsWithoutRef } from "react";

export function ChatBubble({
  user = false,
  className,
  style,
  ...props
}: ComponentPropsWithoutRef<"div"> & { user?: boolean }) {
  return (
    <div
      dir="auto"
      {...props}
      className={`max-w-full ${user ? "bg-chat-user text-chat-user-foreground" : "text-foreground"} ${className ?? ""}`}
      style={{
        borderRadius: user ? CHAT_BUBBLE.radius : 0,
        paddingInline: user ? CHAT_BUBBLE.paddingHorizontal : 0,
        paddingBlock: user ? CHAT_BUBBLE.paddingVertical : 0,
        fontSize: CHAT_BUBBLE.fontSize,
        lineHeight: `${CHAT_BUBBLE.lineHeight}px`,
        ...style,
      }}
    />
  );
}
