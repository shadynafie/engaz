import type { Connection, MessageBlock } from "@engaz/contracts";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View, type ViewProps } from "react-native";
import { rpc } from "../lib/api";
import { appConnectPresentation } from "../lib/app-connect";
import type { ConnectionAuthorization } from "../lib/connection-authorization";
import { finishConnectionAuthorization } from "../lib/connection-authorization";
import { confirmConnectionCode } from "../lib/connection-code";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";

export function AppConnectCard({
  botId,
  block,
  accessibilityActions,
  onAccessibilityAction,
}: {
  botId: string;
  block: Extract<MessageBlock, { kind: "app_connect" }>;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<"pending" | "connected">(block.status);
  const [error, setError] = useState<string | null>(null);
  const connectionAttempt = useRef<AbortController | null>(null);
  const status = block.status === "connected" ? "connected" : localStatus;
  const view = appConnectPresentation({ ...block, status }, busy);

  useEffect(() => () => connectionAttempt.current?.abort(), []);

  async function authorize() {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setBusy(true);
    setError(null);
    try {
      const started = await rpc<ConnectionAuthorization>(
        "connections/begin",
        {
          connectorId: block.connectorId,
          provider: block.provider,
          displayName: block.name,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      let verified: Connection | undefined;
      const connected = await finishConnectionAuthorization(started, {
        signal: controller.signal,
        openUrl: Linking.openURL,
        confirmCode: confirmConnectionCode,
        complete: async (connectionId, authorizationId) => {
          const row = await rpc<Connection>(
            "connections/complete",
            { connectionId, authorizationId },
            { signal: controller.signal },
          ).catch(() => undefined);
          if (row?.status === "connected") verified = row;
          return row;
        },
      });
      if (controller.signal.aborted || connected === null) return;
      if (connected && verified) {
        const current =
          (await rpc<Connection[]>("connections/list", {}, { signal: controller.signal })).find(
            (row) => row.id === verified!.id,
          ) ?? verified;
        await rpc(
          "connections/setAgents",
          {
            connectionId: verified.id,
            botIds: [...new Set([...(current.agentIds ?? []), botId])],
          },
          { signal: controller.signal },
        );
        await rpc(
          "onboarding/appConnected",
          { botId, provider: block.provider, connectorId: block.connectorId },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setLocalStatus("connected");
        return;
      }
      if (!controller.signal.aborted) setError(t("Authorization timed out. Please try again."));
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t("Could not authorize this app"));
      }
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <View
      accessibilityLabel={t("{name} connection", { name: block.name })}
      style={{
        width: "90%",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: tokens.muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
            {block.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={onAccessibilityAction}
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
          >
            {view.title}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13.5 }} numberOfLines={2}>
            {view.description}
          </Text>
        </View>
        {view.showAuthorize ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Connect for this agent")}
            disabled={busy}
            onPress={() => void authorize()}
            style={{
              minHeight: 36,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: native.fillPressed,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {busy ? (
              <ActivityIndicator color={native.label} />
            ) : (
              <Text style={{ color: native.label, fontSize: 14, fontWeight: "600" }}>
                {view.actionLabel}
              </Text>
            )}
          </Pressable>
        ) : (
          <Text style={{ color: tokens.success, fontSize: 13.5, fontWeight: "600" }}>
            {view.actionLabel}
          </Text>
        )}
      </View>
      {error ? <Text style={{ color: tokens.destructive, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}
