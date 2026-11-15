import type { WorkSummary as Summary } from "@engaz/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export function WorkSummary({ summary, runId }: { summary: Summary; runId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const tokens = useMobileTokens();
  return (
    <View style={{ marginTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
          {summary.count === 1 ? t("1 action") : t("{count} actions", { count: summary.count })}
        </Text>
      </Pressable>
      {open
        ? summary.steps.map((step) => (
            <Text
              key={step.label}
              style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 4 }}
            >
              {step.label}
              {step.count > 1 ? ` × ${step.count}` : ""}
            </Text>
          ))
        : null}
      {open && runId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/activity-details", params: { runId } })}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t("Details")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
