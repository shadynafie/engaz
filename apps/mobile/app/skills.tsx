import type { AgentSkill, AgentSkillCatalogEntry, TaughtSkill } from "@engaz/contracts";
import { parseSkillMd } from "@engaz/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

type Draft = { skillId: string | null; name: string; description: string; body: string };

/** One agent's skills: switch each on or off, and write or edit them. Mirrors the web section. */
export default function Skills() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const [skills, setSkills] = useState<AgentSkillCatalogEntry[] | null>(null);
  const [taught, setTaught] = useState<TaughtSkill[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, taughtSkills] = await Promise.all([
      rpc<AgentSkillCatalogEntry[]>("agentSkills/list", {}),
      rpc<TaughtSkill[]>("skills/list", { botId }).catch(() => []),
    ]);
    setSkills(list);
    setTaught(taughtSkills.filter((skill) => skill.status === "saved"));
  }, [botId]);

  useEffect(() => {
    void refresh().catch(() => {
      setSkills([]);
      setError(t("Could not load"));
    });
  }, [refresh, t]);

  async function toggle(skill: AgentSkillCatalogEntry, assigned: boolean) {
    setError(null);
    const previous = skills;
    const botIds = assigned ? [...skill.botIds, botId] : skill.botIds.filter((id) => id !== botId);
    setSkills(
      (skills ?? []).map((entry) => (entry.id === skill.id ? { ...entry, botIds } : entry)),
    );
    try {
      await rpc("agentSkills/setAssigned", { skillId: skill.id, botId, assigned });
    } catch {
      setSkills(previous);
      setError(t("Could not save skill"));
    }
  }

  async function open(entry: AgentSkillCatalogEntry) {
    if (busy) return;
    setError(null);
    try {
      const skill = await rpc<AgentSkill>("agentSkills/get", { skillId: entry.id });
      const parsed = parseSkillMd(skill.content);
      setDraft({
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        body: "error" in parsed ? "" : parsed.body,
      });
    } catch {
      setError(t("Could not load skill"));
    }
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    const fields = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      body: draft.body,
    };
    try {
      if (draft.skillId) await rpc("agentSkills/update", { skillId: draft.skillId, ...fields });
      else await rpc("agentSkills/create", { ...fields, botId });
      setDraft(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && /already exists/i.test(cause.message)
          ? t("A skill with that name already exists.")
          : t("Could not save skill"),
      );
    } finally {
      setBusy(false);
    }
  }

  function remove(skillId: string, name: string) {
    Alert.alert(t("Delete {name}?", { name }), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void rpc("agentSkills/remove", { skillId })
            .then(async () => {
              setDraft(null);
              await refresh();
            })
            .catch(() => setError(t("Could not delete skill")))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const editing = draft ? skills?.find((skill) => skill.id === draft.skillId) : undefined;
  const readOnly = Boolean(editing?.readOnly);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!skills ? <ActivityIndicator /> : null}

      {draft ? (
        <View style={[styles.card, styles.form]}>
          <Text style={styles.label}>{t("Name")}</Text>
          <TextInput
            value={draft.name}
            maxLength={80}
            editable={!busy && !readOnly}
            onChangeText={(name) => setDraft({ ...draft, name })}
            accessibilityLabel={t("Name")}
            style={styles.input}
          />
          <Text style={styles.label}>{t("When to use")}</Text>
          <TextInput
            value={draft.description}
            maxLength={2000}
            multiline
            editable={!busy && !readOnly}
            onChangeText={(description) => setDraft({ ...draft, description })}
            accessibilityLabel={t("When to use")}
            style={[styles.input, styles.multiline]}
          />
          <Text style={styles.label}>{t("Instructions")}</Text>
          <TextInput
            value={draft.body}
            multiline
            editable={!busy && !readOnly}
            onChangeText={(body) => setDraft({ ...draft, body })}
            accessibilityLabel={t("Instructions")}
            style={[styles.input, styles.multiline, styles.instructions]}
          />
          <View style={styles.inline}>
            {!readOnly ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy || !draft.name.trim() || !draft.description.trim()}
                onPress={() => void save()}
                style={[
                  styles.smallButton,
                  styles.primary,
                  (busy || !draft.name.trim() || !draft.description.trim()) && styles.disabled,
                ]}
              >
                <Text style={styles.buttonLabel}>{t("Save")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setDraft(null)}
              style={styles.smallButton}
            >
              <Text style={styles.buttonLabel}>{readOnly ? t("Close") : t("Cancel")}</Text>
            </Pressable>
            <View style={styles.grow} />
            {draft.skillId && !readOnly ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => draft.skillId && remove(draft.skillId, draft.name)}
              >
                <Text style={styles.remove}>{t("Delete")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {!draft && skills ? (
        <>
          {skills.length === 0 && taught.length === 0 ? (
            <Text style={styles.secondary}>{t("This agent has no skills yet.")}</Text>
          ) : null}
          {skills.length > 0 || taught.length > 0 ? (
            <View style={styles.card}>
              {skills.map((skill) => (
                <View key={skill.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void open(skill)}
                    style={styles.grow}
                  >
                    <Text style={styles.body} numberOfLines={1}>
                      {skill.name}
                    </Text>
                    <Text style={styles.secondary} numberOfLines={1}>
                      {skill.description}
                    </Text>
                  </Pressable>
                  <Switch
                    accessibilityLabel={skill.name}
                    value={skill.botIds.includes(botId)}
                    onValueChange={(value) => void toggle(skill, value)}
                  />
                </View>
              ))}
              {taught.map((skill) => (
                <View key={skill.id} style={styles.row}>
                  <Text style={[styles.body, styles.grow]} numberOfLines={1}>
                    {skill.name || skill.goal}
                  </Text>
                  <Text style={styles.secondary}>{t("Taught")}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(null);
              setDraft({ skillId: null, name: "", description: "", body: "" });
            }}
            style={styles.smallButton}
          >
            <Text style={styles.buttonLabel}>{t("New skill")}</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 12 },
    card: { borderRadius: 16, backgroundColor: native.fill, overflow: "hidden" },
    form: { gap: 8, padding: 16 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    inline: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
    grow: { flex: 1, gap: 3, minWidth: 0 },
    label: { color: native.secondaryLabel, fontSize: 13, fontWeight: "600", marginTop: 4 },
    body: { color: native.label, fontSize: 15 },
    secondary: { color: native.secondaryLabel, fontSize: 13 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: native.fillPressed,
      color: native.label,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
    },
    multiline: { minHeight: 72, textAlignVertical: "top" },
    instructions: { minHeight: 160 },
    smallButton: {
      minHeight: 42,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: native.fill,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: { backgroundColor: native.fillPressed },
    disabled: { opacity: 0.4 },
    buttonLabel: { color: native.label, fontSize: 14, fontWeight: "600" },
    remove: { color: tokens.destructive, fontSize: 14, fontWeight: "600" },
    error: { color: tokens.destructive, fontSize: 14 },
  });
}
