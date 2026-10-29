import type { ColorTokens } from "@engaz/ui-tokens";
import { CHAT_BUBBLE } from "@engaz/ui-tokens";
import type { PressableProps, ViewProps, ViewStyle } from "react-native";
import { Pressable, View } from "react-native";

type BubbleAppearance = { palette: ColorTokens; user?: boolean };

function bubbleStyle({ palette, user }: BubbleAppearance): ViewStyle {
  return {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    backgroundColor: user ? palette.chatUser : "transparent",
    paddingHorizontal: user ? CHAT_BUBBLE.paddingHorizontal : 0,
    paddingVertical: user ? CHAT_BUBBLE.paddingVertical : 0,
    borderRadius: user ? CHAT_BUBBLE.radius : 0,
  };
}

export function ChatBubble({ palette, user, style, ...props }: ViewProps & BubbleAppearance) {
  return <View {...props} style={[bubbleStyle({ palette, user }), style]} />;
}

export function PressableChatBubble({
  palette,
  user,
  style,
  ...props
}: PressableProps & BubbleAppearance) {
  return (
    <Pressable
      {...props}
      style={(state) => [
        bubbleStyle({ palette, user }),
        typeof style === "function" ? style(state) : style,
      ]}
    />
  );
}
