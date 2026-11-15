import type { Artifact } from "@engaz/contracts";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { openMobileArtifact, readMobileArtifactText } from "../lib/artifact-open";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function Files() {
  const { botId, groupId } = useLocalSearchParams<{ botId?: string; groupId?: string }>();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [files, setFiles] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setFiles(await rpc<Artifact[]>("artifacts/list", groupId ? { groupId } : { botId }));
    } catch {
      setError(t("Could not load files"));
    }
  }, [botId, groupId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function open(file: Artifact) {
    setBusy(true);
    setError(null);
    const target = groupId ? { groupId } : { botId: botId! };
    try {
      if (file.mimeType.startsWith("text/") && file.size <= 256 * 1024) {
        setPreview(await readMobileArtifactText(target, file.id, file.mimeType));
      } else await openMobileArtifact(target, file.id, file.name, file.mimeType);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not open file"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        accessibilityLabel={t("Search files")}
        placeholder={t("Search files")}
        placeholderTextColor={tokens.mutedForeground}
        value={query}
        onChangeText={setQuery}
        style={{
          color: tokens.foreground,
          backgroundColor: tokens.muted,
          borderRadius: 10,
          padding: 12,
        }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => void load()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: tokens.foreground }}>{t("Refresh files")}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
      {files === null && !error ? <ActivityIndicator color={tokens.foreground} /> : null}
      {files?.length === 0 ? (
        <Text style={{ color: tokens.mutedForeground }}>{t("No files yet")}</Text>
      ) : null}
      {files
        ?.filter((file) => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map((file) => (
          <View
            key={file.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              borderColor: tokens.border,
              gap: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void open(file)}
              style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: tokens.foreground }}>{file.name}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Share {name}", { name: file.name })}
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void openMobileArtifact(
                  groupId ? { groupId } : { botId: botId! },
                  file.id,
                  file.name,
                  file.mimeType,
                )
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : t("Could not open file")),
                  )
                  .finally(() => setBusy(false));
              }}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
            >
              <Text style={{ color: tokens.foreground }}>{t("Share")}</Text>
            </Pressable>
          </View>
        ))}
      {preview !== null ? (
        <Text
          selectable
          style={{
            color: tokens.foreground,
            backgroundColor: tokens.muted,
            padding: 12,
            borderRadius: 10,
          }}
        >
          {preview}
        </Text>
      ) : null}
    </ScrollView>
  );
}
