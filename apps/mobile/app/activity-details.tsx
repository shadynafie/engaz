import type { RunActivityDetails } from "@engaz/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function ActivityDetails() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const router = useRouter();
  const [details, setDetails] = useState<RunActivityDetails | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void rpc<RunActivityDetails>("runs/details", { runId })
      .then((value) => {
        if (!cancelled) setDetails(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);
  const label = { color: tokens.mutedForeground, fontSize: 13 };
  const value = { color: tokens.foreground, fontSize: 15 };
  const source = details?.source;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 24, gap: 18 }}
    >
      <Stack.Screen options={{ title: t("Activity details") }} />
      {!details && !failed ? <ActivityIndicator color={tokens.mutedForeground} /> : null}
      {failed ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {t("Could not load activity.")}
        </Text>
      ) : null}
      {details ? (
        <>
          <View style={{ gap: 6 }}>
            <Text style={label}>{t("Started by")}</Text>
            <Text style={value}>{triggerLabel(details.originalTrigger, t)}</Text>
          </View>
          {details.trigger !== details.originalTrigger ? (
            <View style={{ gap: 6 }}>
              <Text style={label}>{t("Received through")}</Text>
              <Text style={value}>{triggerLabel(details.trigger, t)}</Text>
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text style={label}>{t("Authority")}</Text>
            <Text style={value}>{t("Your account")}</Text>
          </View>
          {details.routine ? (
            <View style={{ gap: 6 }}>
              <Text style={label}>{t("Routine")}</Text>
              <Text style={value}>{details.routine.name}</Text>
            </View>
          ) : null}
          {source ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push(
                  source.groupId
                    ? {
                        pathname: "/group-thread",
                        params: { groupId: source.groupId, name: source.groupName ?? t("Group") },
                      }
                    : {
                        pathname: "/thread",
                        params: { botId: source.botId, name: source.botName },
                      },
                )
              }
            >
              <Text style={label}>{t("Source")}</Text>
              <Text style={value}>{source.botName}</Text>
            </Pressable>
          ) : null}
          {details.effects.length === 0 ? (
            <Text style={label}>{t("No recorded actions.")}</Text>
          ) : (
            details.effects.map((effect) => (
              <View
                key={effect.id}
                style={{ borderTopWidth: 1, borderColor: tokens.border, paddingTop: 12, gap: 6 }}
              >
                <Text style={value}>{effect.tool}</Text>
                <Text style={label}>
                  {effect.outcome === "succeeded"
                    ? t("Tool completed")
                    : effect.outcome.replaceAll("_", " ")}
                </Text>
                <Text style={value}>
                  {effect.reason}
                  {effect.decidedByYou ? ` ${t("Decision made by you.")}` : ""}
                </Text>
              </View>
            ))
          )}
          {details.moreEffects ? (
            <Text style={label}>{t("Showing the first 100 actions.")}</Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function triggerLabel(trigger: string | null, t: (message: string) => string): string {
  switch (trigger) {
    case "user":
    case "reaction":
      return t("A person");
    case "routine":
      return t("A schedule");
    case "webhook":
      return t("A webhook");
    case "bot_message":
    case "spawn":
      return t("Another agent");
    case "messaging":
      return t("An incoming message");
    case "cloud_agent":
      return t("A remote agent");
    case "follow_up":
      return t("A handoff or follow-up");
    case "resume":
      return t("Resumed work");
    case "skill":
      return t("A skill");
    default:
      return t("Not recorded");
  }
}
