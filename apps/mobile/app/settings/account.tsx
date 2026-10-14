/**
 * 账户：邮箱、昵称、注册日期，退出登录；删除账户放在最底下，展开后先列出会被删掉的东西，再输入密码确认。
 */

import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import { BackBar, Button, Field, Icon, Notice, useOverlay, type IconName } from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, onColor, space, usePalette } from "../../src/theme/index.ts";

type Counts = { stories: number; scenarios: number; keys: number };

export default function AccountScreen() {
  const { api, user, signOut } = useApp();
  const palette = usePalette();
  const overlay = useOverlay();
  const [expanded, setExpanded] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = user?.display_name || user?.email || "";
  const joined = user?.created_at ? user.created_at.slice(0, 10) : "";

  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && !counts) {
      Promise.all([api.playthroughs.list(), api.scenarios.list(), api.credentials.list()])
        .then(([stories, scenarios, keys]) =>
          setCounts({ stories: stories.length, scenarios: scenarios.length, keys: keys.length }),
        )
        .catch(() => undefined);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "删除账户？",
      message: "所有故事、剧本和密钥都会被永久删除，无法恢复。",
      confirmLabel: "删除账户",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.auth.deleteAccount(password);
      await signOut();
    } catch (e) {
      setError(describeError(e));
      setDeleting(false);
    }
  };

  const stat = (icon: IconName, value: number | undefined, label: string, last?: boolean) => (
    <View style={[styles.stat, last ? null : { borderRightWidth: 1, borderRightColor: palette.line }]}>
      <Icon name={icon} size={18} />
      <Text style={{ fontFamily: font.monoMedium, fontSize: 18, color: palette.ink }}>{value ?? "–"}</Text>
      <Text style={{ fontSize: 12.5, color: palette.mut }}>{label}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <BackBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.head, { borderBottomColor: palette.ink }]}>
          <View style={[styles.avatar, { backgroundColor: palette.acc }]}>
            <Text style={{ fontSize: 32, fontWeight: "900", color: onColor }}>{[...name][0] ?? "?"}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.name, { color: palette.ink }]}>
              {name}
            </Text>
            {joined ? <Text style={[styles.mono, { color: palette.mut }]}>注册于 {joined}</Text> : null}
          </View>
        </View>
        <View style={[styles.kv, { borderBottomColor: palette.line }]}>
          <Text style={[styles.key, { color: palette.mut }]}>邮箱</Text>
          <Text style={{ flex: 1, fontSize: 15, color: palette.ink }} selectable>
            {user?.email}
          </Text>
        </View>
        <View style={[styles.kv, { borderBottomColor: palette.line }]}>
          <Text style={[styles.key, { color: palette.mut }]}>昵称</Text>
          <Text style={{ flex: 1, fontSize: 15, color: user?.display_name ? palette.ink : palette.mut }}>
            {user?.display_name || "没有设置"}
          </Text>
        </View>
        <View style={{ padding: space.page }}>
          <Button
            label="退出登录"
            variant="secondary"
            trailingIcon="logout"
            between
            onPress={() => void signOut()}
          />
        </View>

        <View style={[styles.danger, { borderTopColor: palette.err }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={toggle}
            style={styles.dangerHead}
          >
            <Text style={{ flex: 1, fontSize: 17, fontWeight: "700", color: palette.err }}>删除账户</Text>
            <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={palette.err} />
          </Pressable>
          {expanded ? (
            <View style={{ gap: 14 }}>
              <View style={[styles.stats, { borderColor: palette.line }]}>
                {stat("story", counts?.stories, "故事")}
                {stat("library", counts?.scenarios, "剧本")}
                {stat("key", counts?.keys, "密钥", true)}
              </View>
              <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
                所有故事、剧本和密钥都会被永久删除，无法恢复。
              </Text>
              {error ? <Notice message={error} /> : null}
              <Field
                label="输入密码确认"
                hideLabel
                placeholder="输入密码确认"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
              />
              <Button
                label="删除账户"
                variant="danger"
                onPress={() => void confirmDelete()}
                busy={deleting}
                disabled={!password}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.l,
    paddingHorizontal: space.page,
    paddingTop: space.s,
    paddingBottom: space.page,
    borderBottomWidth: 1,
  },
  avatar: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.6 },
  mono: { fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.5 },
  kv: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  key: { width: 72, fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.7 },
  danger: { marginTop: space.xxl, marginHorizontal: space.page, borderTopWidth: 2, paddingTop: space.xs },
  dangerHead: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  stats: { flexDirection: "row", borderWidth: 1 },
  stat: { flex: 1, padding: space.m, gap: 6 },
});
