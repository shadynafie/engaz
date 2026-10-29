import { groupAvatarLayout } from "@engaz/core";
import { memo } from "react";
import { Text, View } from "react-native";
import { useMobileTokens } from "../lib/native";
import { BotAvatar } from "./bot-avatar";
import { NativeSymbol } from "./native-symbol";

export interface GroupAvatarMember {
  botId?: string;
  name?: string;
  color: string;
  status?: string;
}

export const GroupAvatar = memo(function GroupAvatar({
  members,
  size = 54,
}: {
  members: GroupAvatarMember[];
  size?: number;
}) {
  const tokens = useMobileTokens();
  const firstMember = members[0];
  if (!firstMember) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tokens.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <NativeSymbol
          ios="person.3.fill"
          android="people"
          size={Math.round(size * 0.48)}
          color={tokens.mutedForeground}
        />
      </View>
    );
  }

  if (members.length === 1) {
    return (
      <BotAvatar
        color={firstMember.color}
        identity={firstMember.botId ?? firstMember.name}
        size={size}
        status={firstMember.status}
      />
    );
  }

  const { miniSize, positions, visibleCount, overflowCount } = groupAvatarLayout(
    members.length,
    size,
  );
  const visibleMembers = members.slice(0, visibleCount);

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {visibleMembers.map((member, index) => (
        <View
          key={member.botId ?? index}
          style={{
            position: "absolute",
            ...positions[index],
            zIndex: index + 1,
          }}
        >
          <BotAvatar
            color={member.color}
            identity={member.botId ?? member.name}
            size={miniSize}
            status={member.status}
          />
        </View>
      ))}
      {overflowCount > 0 ? (
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            zIndex: 3,
            width: miniSize,
            height: miniSize,
            borderRadius: miniSize / 2,
            backgroundColor: tokens.secondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: tokens.secondaryForeground, fontSize: 10, fontWeight: "600" }}>
            +{overflowCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
