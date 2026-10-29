import type { RunErrorKind } from "@engaz/core";
import { classifyRunError } from "@engaz/core";
import { Alert, Pressable, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export function RunErrorNotice({
  error,
  onChooseModel,
  onOpenModels,
}: {
  error: string;
  onChooseModel: () => void;
  onOpenModels: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const { kind, recovery } = classifyRunError(error);
  const summaries: Record<RunErrorKind, string> = {
    "missing-model": t("Connect a model to continue."),
    authentication: t("The model connection was rejected."),
    model: t("This model cannot run this request."),
    usage: t("The model connection has reached its usage limit."),
    temporary: t("The service is unavailable. Try again."),
    unknown: t("The run could not finish."),
  };
  const actionLabel =
    recovery === "choose-model"
      ? t("Choose a model")
      : recovery === "replace-key"
        ? t("Replace key")
        : t("Connect a model");
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
        {summaries[kind]}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {recovery ? (
          <Pressable
            accessibilityRole="button"
            onPress={recovery === "choose-model" ? onChooseModel : onOpenModels}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: tokens.foreground, fontWeight: "600" }}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => Alert.alert(t("Details"), error)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: tokens.mutedForeground }}>{t("Details")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
