import type { Bot, BotMcpServer, McpServer } from "@engaz/contracts";
import { deriveMcpSlug, suggestedServerName } from "@engaz/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

type Assignments = Record<string, BotMcpServer[]>;

/** MCP servers, their status, and which agents may use which tools; mirrors the web screen. */
export default function McpServers() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  // Presets (Treg, Executor) open the add form already filled in.
  const draft = useLocalSearchParams<{ name?: string; endpoint?: string }>();
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(Boolean(draft.name || draft.endpoint));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [name, setName] = useState(draft.name ?? "");
  const [endpoint, setEndpoint] = useState(draft.endpoint ?? "");
  const [secret, setSecret] = useState("");
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [nextServers, nextBots, all] = await Promise.all([
      rpc<McpServer[]>("mcp/servers/list"),
      rpc<Bot[]>("bots/list"),
      rpc<BotMcpServer[]>("mcp/assignments/all"),
    ]);
    const activeBots = nextBots.filter((bot) => !bot.archivedAt);
    setServers(nextServers);
    setBots(activeBots);
    setAssignments(
      Object.fromEntries(
        activeBots.map((bot) => [bot.id, all.filter((entry) => entry.botId === bot.id)]),
      ),
    );
    return { servers: nextServers, bots: activeBots };
  }

  useEffect(() => {
    void refresh()
      .then((next) => {
        if (next.servers.length === 0) setAdding(true);
        if (next.servers.length === 1) setExpanded(next.servers[0]!.id);
        if (next.bots.length === 1) setSelectedBotIds([next.bots[0]!.id]);
      })
      .catch((reason) => setError(errorText(reason, t("Could not load MCP servers"))))
      .finally(() => setLoaded(true));
    // Sign-in finishes in the browser; look again when the owner comes back.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  async function run(key: string, action: () => Promise<void>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason, fallback));
    } finally {
      setBusy(null);
    }
  }

  function addServer() {
    const serverName = name.trim() || suggestedServerName(endpoint);
    if (!endpoint.trim()) {
      setError(t("Add the server address."));
      return;
    }
    if (!serverName) {
      setError(t("Add a name."));
      return;
    }
    void run(
      "add",
      async () => {
        // The API tries the older SSE connection itself when this one gets no answer.
        const created = await rpc<McpServer>("mcp/servers/create", {
          slug: deriveMcpSlug(serverName),
          name: serverName,
          transport: "streamable_http",
          endpoint: endpoint.trim(),
          headers: {},
          secret: secret.trim() || undefined,
          enabled: true,
        });
        await Promise.all(
          selectedBotIds.map((botId) =>
            rpc("mcp/assignments/approve", { botId, serverId: created.id }),
          ),
        );
        await refresh();
        setAdding(false);
        setExpanded(created.id);
        setName("");
        setEndpoint("");
        setSecret("");
      },
      t("Could not add MCP server"),
    );
  }

  function checkServer(server: McpServer) {
    void run(
      `check:${server.id}`,
      async () => {
        const checked = await rpc<McpServer>("mcp/servers/check", { id: server.id });
        setServers((list) => list.map((item) => (item.id === server.id ? checked : item)));
      },
      t("Could not check this server"),
    );
  }

  function replaceToken(server: McpServer) {
    void run(
      `check:${server.id}`,
      async () => {
        const updated = await rpc<McpServer>("mcp/servers/update", {
          id: server.id,
          secret: newToken.trim(),
        });
        setServers((list) => list.map((item) => (item.id === server.id ? updated : item)));
        setNewToken("");
      },
      t("Could not save the access token"),
    );
  }

  async function replaceAssignments(botId: string, next: BotMcpServer[]) {
    const updated = await rpc<BotMcpServer[]>("mcp/assignments/replace", {
      botId,
      assignments: next.map(({ serverId, allowAllTools, allowedTools }) => ({
        serverId,
        allowAllTools,
        allowedTools,
      })),
    });
    setAssignments((map) => ({ ...map, [botId]: updated }));
  }

  function toggleAgent(server: McpServer, botId: string) {
    const current = assignments[botId] ?? [];
    const assigned = current.some((entry) => entry.serverId === server.id);
    void run(
      `agent:${server.id}:${botId}`,
      async () => {
        if (assigned) {
          await replaceAssignments(
            botId,
            current.filter((entry) => entry.serverId !== server.id),
          );
          return;
        }
        const added = await rpc<BotMcpServer>("mcp/assignments/approve", {
          botId,
          serverId: server.id,
        });
        setAssignments((map) => ({ ...map, [botId]: [...current, added] }));
      },
      t("Could not update agent access"),
    );
  }

  function toggleTool(server: McpServer, botId: string, tool: string) {
    const current = assignments[botId] ?? [];
    const entry = current.find((item) => item.serverId === server.id);
    if (!entry) return;
    const allowed = entry.allowAllTools ? server.check.tools : entry.allowedTools;
    const nextTools = allowed.includes(tool)
      ? allowed.filter((item) => item !== tool)
      : [...allowed, tool];
    void run(
      `tool:${server.id}:${botId}`,
      () =>
        replaceAssignments(
          botId,
          current.map((item) =>
            item.serverId === server.id
              ? { ...item, allowAllTools: false, allowedTools: nextTools }
              : item,
          ),
        ),
      t("Could not update agent access"),
    );
  }

  function deleteServer(server: McpServer) {
    Alert.alert(t("Delete {name}?", { name: server.name }), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () =>
          void run(
            `delete:${server.id}`,
            async () => {
              await rpc("mcp/servers/remove", { id: server.id });
              setExpanded(null);
              const next = await refresh();
              if (next.servers.length === 0) setAdding(true);
            },
            t("Could not delete MCP server"),
          ),
      },
    ]);
  }

  function statusLine(server: McpServer) {
    const { status, tools } = server.check;
    const tone =
      status === "working"
        ? mobileTokens().success
        : status === "failing"
          ? mobileTokens().destructive
          : status === "sign_in"
            ? mobileTokens().warning
            : native.tertiaryLabel;
    const label =
      status === "working"
        ? tools.length === 1
          ? t("Working · 1 tool")
          : t("Working · {count} tools", { count: tools.length })
        : status === "sign_in"
          ? t("Sign in needed")
          : status === "failing"
            ? t("Needs attention")
            : t("Not checked yet");
    return (
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.secondary}>{label}</Text>
      </View>
    );
  }

  function renderServer(server: McpServer) {
    const open = expanded === server.id;
    const users = bots.filter((bot) =>
      (assignments[bot.id] ?? []).some((entry) => entry.serverId === server.id),
    );
    const needsSignIn = server.check.status === "sign_in" || server.oauthStatus === "reconnect";
    const tokenRefused =
      server.check.status === "failing" &&
      server.transport !== "stdio" &&
      server.oauthStatus === "none";
    const descriptions = server.check.toolDescriptions ?? {};
    return (
      <View key={server.id} style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setExpanded(open ? null : server.id);
            setNewToken("");
          }}
          style={styles.cardHeader}
        >
          <View style={styles.grow}>
            <Text style={styles.title}>{server.name}</Text>
            {statusLine(server)}
            <Text style={styles.secondary}>
              {users.length > 0
                ? t("Used by {names}", { names: users.map((bot) => bot.name).join(", ") })
                : t("No agent uses it yet")}
            </Text>
          </View>
          <Text style={styles.chevron}>{open ? "˅" : "›"}</Text>
        </Pressable>
        {open ? (
          <View style={styles.details}>
            <Text numberOfLines={1} style={styles.secondary}>
              {server.endpoint ?? server.command ?? server.slug}
            </Text>
            {server.check.status === "failing" && server.check.message ? (
              <Text style={styles.error}>{server.check.message}</Text>
            ) : null}
            {needsSignIn ? (
              // The sign-in callback belongs to the web app, which a phone browser is not signed in to.
              <Text style={styles.secondary}>{t("Finish MCP authorization in the web app.")}</Text>
            ) : null}
            {tokenRefused ? (
              <View style={styles.inline}>
                <TextInput
                  value={newToken}
                  onChangeText={setNewToken}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t("New access token")}
                  placeholder={t("New access token")}
                  placeholderTextColor={native.tertiaryLabel}
                  style={[styles.input, styles.grow]}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null || !newToken.trim()}
                  onPress={() => replaceToken(server)}
                  style={styles.smallButton}
                >
                  <Text style={styles.buttonLabel}>{t("Save")}</Text>
                </Pressable>
              </View>
            ) : null}
            {bots.length > 0 ? <Text style={styles.section}>{t("Agents")}</Text> : null}
            {bots.map((bot) => {
              const entry = (assignments[bot.id] ?? []).find((item) => item.serverId === server.id);
              const allowed = entry
                ? entry.allowAllTools
                  ? server.check.tools
                  : entry.allowedTools
                : [];
              return (
                <View key={bot.id} style={styles.agent}>
                  <View style={styles.inline}>
                    <Text style={[styles.body, styles.grow]}>{bot.name}</Text>
                    <Switch
                      accessibilityLabel={bot.name}
                      disabled={busy !== null}
                      value={Boolean(entry)}
                      onValueChange={() => toggleAgent(server, bot.id)}
                    />
                  </View>
                  {entry
                    ? server.check.tools.map((tool) => {
                        const checked = allowed.includes(tool);
                        return (
                          <Pressable
                            key={tool}
                            accessibilityRole="checkbox"
                            accessibilityLabel={tool}
                            accessibilityState={{ checked, disabled: busy !== null }}
                            disabled={busy !== null}
                            onPress={() => toggleTool(server, bot.id, tool)}
                            style={styles.tool}
                          >
                            <Text style={styles.check}>{checked ? "✓" : ""}</Text>
                            <View style={styles.grow}>
                              <Text style={styles.body}>{descriptions[tool] ?? tool}</Text>
                              {descriptions[tool] ? (
                                <Text style={styles.toolName}>{tool}</Text>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              );
            })}
            <View style={styles.inline}>
              {needsSignIn ? null : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() => checkServer(server)}
                  style={styles.smallButton}
                >
                  <Text style={styles.buttonLabel}>
                    {busy === `check:${server.id}` ? t("Checking…") : t("Check again")}
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => deleteServer(server)}
                style={styles.smallButton}
              >
                <Text style={styles.remove}>{t("Delete")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  const addForm = (
    <View style={styles.form}>
      <Text style={styles.section}>{t("Server address")}</Text>
      <TextInput
        value={endpoint}
        onChangeText={setEndpoint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel={t("Server address")}
        placeholder="https://example.com/mcp"
        placeholderTextColor={native.tertiaryLabel}
        style={styles.input}
      />
      <Text style={styles.section}>{t("Name")}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        accessibilityLabel={t("Name")}
        placeholder={suggestedServerName(endpoint) || t("e.g. Files")}
        placeholderTextColor={native.tertiaryLabel}
        style={styles.input}
      />
      <Text style={styles.section}>{t("Access token (optional)")}</Text>
      <TextInput
        value={secret}
        onChangeText={setSecret}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t("Access token (optional)")}
        placeholderTextColor={native.tertiaryLabel}
        style={styles.input}
      />
      {bots.length > 0 ? (
        <>
          <Text style={styles.section}>{t("Agents that can use it")}</Text>
          {bots.map((bot) => (
            <View key={bot.id} style={styles.inline}>
              <Text style={[styles.body, styles.grow]}>{bot.name}</Text>
              <Switch
                accessibilityLabel={bot.name}
                value={selectedBotIds.includes(bot.id)}
                onValueChange={() =>
                  setSelectedBotIds((current) =>
                    current.includes(bot.id)
                      ? current.filter((id) => id !== bot.id)
                      : [...current, bot.id],
                  )
                }
              />
            </View>
          ))}
        </>
      ) : null}
      <View style={styles.inline}>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={addServer}
          style={[styles.smallButton, styles.primary]}
        >
          {busy === "add" ? (
            <ActivityIndicator color={native.label} />
          ) : (
            <Text style={styles.buttonLabel}>{t("Connect")}</Text>
          )}
        </Pressable>
        {servers.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => setAdding(false)}
            style={styles.smallButton}
          >
            <Text style={styles.buttonLabel}>{t("Cancel")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {!loaded ? (
          <ActivityIndicator color={native.fillPressed} />
        ) : adding ? (
          addForm
        ) : (
          <>
            {servers.map(renderServer)}
            <Pressable
              accessibilityRole="button"
              onPress={() => setAdding(true)}
              style={styles.smallButton}
            >
              <Text style={styles.buttonLabel}>{t("Add server")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 12 },
    form: { gap: 10 },
    card: { borderRadius: 16, backgroundColor: native.fill, overflow: "hidden" },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 16 },
    details: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
    agent: { gap: 6 },
    tool: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingLeft: 4 },
    check: { width: 18, color: native.label, fontSize: 15, fontWeight: "700" },
    toolName: { color: native.secondaryLabel, fontSize: 11, fontFamily: "Menlo" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    inline: { flexDirection: "row", alignItems: "center", gap: 8 },
    grow: { flex: 1, gap: 3, minWidth: 0 },
    title: { color: native.label, fontSize: 16, fontWeight: "600" },
    body: { color: native.label, fontSize: 14 },
    section: { color: native.secondaryLabel, fontSize: 13, fontWeight: "600", marginTop: 4 },
    secondary: { color: native.secondaryLabel, fontSize: 13 },
    chevron: { color: native.secondaryLabel, fontSize: 18 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: native.fillPressed,
      color: native.label,
      paddingHorizontal: 14,
      fontSize: 15,
    },
    smallButton: {
      minHeight: 42,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: native.fill,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: { backgroundColor: native.fillPressed },
    buttonLabel: { color: native.label, fontSize: 14, fontWeight: "600" },
    remove: { color: tokens.destructive, fontSize: 14, fontWeight: "600" },
    error: { color: tokens.destructive, fontSize: 14 },
  });
}
