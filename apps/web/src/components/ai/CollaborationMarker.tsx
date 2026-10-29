import { useElapsed } from "@engaz/chat-ui/activity";
import { CHAT_ACTIVITY, CHAT_BUBBLE } from "@engaz/ui-tokens";
import type { GroupAvatarMember } from "@engaz/ui-web";
import { BotAvatar, GroupAvatar } from "@engaz/ui-web";
import type { ReactNode } from "react";

/** Lightweight peer event shown without exposing the exchanged message body. */
export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-testid="peer-receipt-chip"
        aria-label={ariaLabel}
        onClick={onClick}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75"
      >
        <BotAvatar color={color} identity={identity} size={16} />
        <span dir="auto" className="truncate">
          {label}
        </span>
      </button>
    </div>
  );
}

export function ActiveBotGlyph({
  bots,
  label,
  startedAt,
  action,
}: {
  bots: GroupAvatarMember[];
  label: string;
  startedAt?: number;
  action?: ReactNode;
}) {
  const elapsed = useElapsed(startedAt);
  return (
    <div
      className="flex min-h-10 items-center gap-3 px-1"
      style={{ marginTop: CHAT_BUBBLE.messageGap }}
    >
      <span role="status" className="flex min-w-0 items-center" style={{ gap: CHAT_ACTIVITY.gap }}>
        <GroupAvatar members={bots} size={28} />
        <span className="truncate font-medium" style={{ fontSize: CHAT_ACTIVITY.fontSize }}>
          {label}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-mono tabular-nums text-muted-foreground"
          style={{ fontSize: CHAT_ACTIVITY.timerFontSize }}
        >
          {elapsed}
        </span>
      </span>
      {action}
    </div>
  );
}
