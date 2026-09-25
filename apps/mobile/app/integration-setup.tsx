import type { IntegrationSetupState } from "@engaz/contracts";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";

export default function IntegrationSetup() {
  const router = useRouter();
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [state, setState] = useState<IntegrationSetupState | null>(null);
  const [choice, setChoice] = useState<"composio" | "pipedream">("composio");
  const [key, setKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void rpc<IntegrationSetupState>("integrationSetup/get")
      .then((setup) => {
        if (!setup.canConfigure) {
          router.replace("/integrations");
          return;
        }
        setState(setup);
      })
      .catch(() => setError(t("Could not load integrations")));
  }, []);
  // MCP servers have their own screen; this one only sets up app providers.
  const choices = [
    { id: "composio", label: "Composio" },
    { id: "pipedream", label: "Pipedream" },
  ] as const;
  const configured = state?.providers.find((provider) => provider.id === choice)?.configured;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await rpc(
        "integrationSetup/save",
        choice === "composio"
          ? { provider: "composio", apiKey: key }
          : {
              provider: "pipedream",
              clientId,
              clientSecret: key,
              projectId,
              environment: "production",
            },
      );
      setKey("");
      router.replace("/integrations");
    } catch {
      setError(t("Could not verify or save these credentials"));
    } finally {
      setBusy(false);
    }
  }
  function button(label: string, onPress: () => void, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[styles.button, disabled && { opacity: 0.5 }]}
      >
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
    );
  }
  if (!state) return error ? <Text accessibilityRole="alert">{error}</Text> : <ActivityIndicator />;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.choices}>
        {choices.map(({ id, label }) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: choice === id, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setChoice(id);
              setKey("");
              setError(null);
            }}
            style={[styles.choice, choice === id && styles.selected]}
          >
            <Text style={styles.text}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {configured ? <Text style={styles.text}>{t("Connected")}</Text> : null}
      {choice === "pipedream" ? (
        <>
          <Text style={styles.text}>{t("Client ID")}</Text>
          <TextInput
            accessibilityLabel={t("Client ID")}
            value={clientId}
            onChangeText={setClientId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.text}>{t("Project ID")}</Text>
          <TextInput
            accessibilityLabel={t("Project ID")}
            value={projectId}
            onChangeText={setProjectId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </>
      ) : null}
      <Text style={styles.text}>{choice === "composio" ? t("API key") : t("Client secret")}</Text>
      <TextInput
        accessibilityLabel={choice === "composio" ? t("API key") : t("Client secret")}
        value={key}
        onChangeText={setKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {button(t("Get credentials"), () => {
        void Linking.openURL(
          choice === "composio"
            ? "https://dashboard.composio.dev"
            : "https://pipedream.com/docs/connect/mcp/developers",
        );
      })}
      {busy ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {button(
        t("Continue"),
        () => {
          if (key.trim()) void save();
          else router.replace("/");
        },
        busy ||
          (!configured &&
            (!key.trim() || (choice === "pipedream" && (!clientId.trim() || !projectId.trim())))),
      )}
      {button(t("Skip"), () => router.replace("/"), busy)}
    </ScrollView>
  );
}
function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    content: { padding: 20, gap: 16 },
    choices: { borderWidth: 1, borderColor: tokens.border, borderRadius: 12, overflow: "hidden" },
    choice: { padding: 16 },
    selected: { backgroundColor: tokens.muted },
    text: { color: tokens.foreground, fontSize: 16 },
    input: {
      borderWidth: 1,
      borderColor: tokens.border,
      borderRadius: 10,
      padding: 12,
      color: tokens.foreground,
    },
    button: { padding: 14, borderRadius: 10, backgroundColor: tokens.muted },
    buttonText: { color: tokens.foreground, textAlign: "center", fontSize: 16 },
    error: { color: tokens.destructive },
  });
}
