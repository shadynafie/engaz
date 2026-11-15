import type { MemoryDocument } from "@engaz/contracts";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function Memory() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [docs, setDocs] = useState<MemoryDocument[]>([]);
  const [selected, setSelected] = useState<MemoryDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDocs(await rpc<MemoryDocument[]>("memory/list", { botId, scope: "bot" }));
      setError(null);
    } catch {
      setError(t("Could not load"));
    }
  }, [botId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await rpc("memory/update", { documentId: selected.id, content: draft });
      setSelected(null);
      await load();
    } catch {
      setError(t("Could not save"));
    } finally {
      setBusy(false);
    }
  }
  async function forget() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await rpc("memory/remove", { documentId: selected.id, revision: selected.revision });
      setSelected(null);
      await load();
    } catch {
      setError(t("Could not forget memory. Reload and try again."));
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
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          setSelected(null);
          void load();
        }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: tokens.foreground }}>{t("Refresh")}</Text>
      </Pressable>
      {docs.map((doc) => (
        <Pressable
          key={doc.id}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setSelected(doc);
            setDraft(doc.content);
            setError(null);
          }}
          style={{
            minHeight: 48,
            justifyContent: "center",
            borderBottomWidth: 1,
            borderColor: tokens.border,
          }}
        >
          <Text style={{ color: tokens.foreground }}>{doc.path}</Text>
        </Pressable>
      ))}
      {selected ? (
        <View style={{ gap: 12 }}>
          <TextInput
            accessibilityLabel={selected.path}
            multiline
            editable={!busy}
            value={draft}
            onChangeText={setDraft}
            style={{
              color: tokens.foreground,
              backgroundColor: tokens.muted,
              borderRadius: 10,
              padding: 12,
              minHeight: 160,
              textAlignVertical: "top",
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || draft === selected.content}
            onPress={() => void save()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: tokens.foreground }}>{t("Save")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("Forget memory?"),
                t("Removes this memory and its revisions. Chat history and backups are kept."),
                [
                  { text: t("Cancel"), style: "cancel" },
                  { text: t("Forget"), style: "destructive", onPress: () => void forget() },
                ],
              )
            }
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: tokens.destructive }}>{t("Forget")}</Text>
          </Pressable>
        </View>
      ) : null}
      {!docs.length && !error ? (
        <Text style={{ color: tokens.mutedForeground }}>{t("Nothing remembered yet")}</Text>
      ) : null}
    </ScrollView>
  );
}
