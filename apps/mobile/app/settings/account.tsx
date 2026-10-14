/**
 * 账户：邮箱、昵称、注册日期，退出登录；删除账户放在最底下，展开后先列出会被删掉的东西，再输入密码确认。
 */

import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import {
  BackBar,
  Button,
  Field,
  Group,
  Icon,
  Notice,
  useOverlay,
  type IconName,
} from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, onColor, radius, space, usePalette } from "../../src/theme/index.ts";
import { formatDate } from "../../src/utils/format.ts";

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
  const joined = user?.created_at ? formatDate(user.created_at) : "";

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

  const stat = (icon: IconName, value: number | undefined, label: string) => (
    <View
      style={[styles.stat, { backgroundColor: palette.card }]}
      accessibilityLabel={`${label} ${value ?? ""}`}
    >
      <Text style={{ fontFamily: font.monoMedium, fontSize: 17, color: palette.ink }}>{value ?? "–"}</Text>
      <View style={styles.statLabel}>
        <Icon name={icon} size={13} color={palette.mut} />
        <Text style={{ fontSize: 12.5, color: palette.mut }}>{label}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <BackBar />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={[styles.avatar, { backgroundColor: palette.acc }]}>
            <Text style={{ fontSize: 34, fontWeight: "700", color: onColor }}>{[...name][0] ?? "?"}</Text>
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.name, { color: palette.ink }]}>
              {name}
            </Text>
            {joined ? <Text style={{ fontSize: 12.5, color: palette.mut }}>注册于 {joined}</Text> : null}
          </View>
        </View>
        <Group inset={14}>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: palette.mut }]}>邮箱</Text>
            <Text style={{ flex: 1, fontSize: 15, color: palette.ink }} selectable>
              {user?.email}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: palette.mut }]}>昵称</Text>
            <Text style={{ flex: 1, fontSize: 15, color: user?.display_name ? palette.ink : palette.mut }}>
              {user?.display_name || "没有设置"}
            </Text>
          </View>
        </Group>
        <Button label="退出登录" variant="secondary" icon="logout" onPress={() => void signOut()} />

        <View style={[styles.danger, { backgroundColor: palette.errBg }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={toggle}
            style={styles.dangerHead}
          >
            <Icon name="alert" size={20} color={palette.err} />
            <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: palette.err }}>删除账户</Text>
            <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={palette.err} />
          </Pressable>
          {expanded ? (
            <View style={{ gap: space.m }}>
              <View style={styles.stats}>
                {stat("story", counts?.stories, "故事")}
                {stat("library", counts?.scenarios, "剧本")}
                {stat("key", counts?.keys, "密钥")}
              </View>
              <Text
                style={{ fontSize: 14, lineHeight: 22, color: palette.ink2, paddingHorizontal: space.xs }}
              >
                所有故事、剧本和密钥都会被永久删除，无法恢复。
              </Text>
              {error ? <Notice message={error} /> : null}
              <Field
                label="输入密码确认"
                hideLabel
                onGrey
                placeholder="输入密码确认"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
              />
              <Button
                label="删除账户"
                variant="dangerSolid"
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
  content: { paddingHorizontal: space.list, paddingBottom: 56, gap: space.s },
  head: { alignItems: "center", gap: 10, paddingTop: space.page, paddingBottom: 14 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 26, lineHeight: 32, fontWeight: "700" },
  kv: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 56, paddingHorizontal: 14 },
  key: { width: 44, fontSize: 13 },
  danger: {
    marginTop: 20,
    paddingTop: space.s,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderRadius: radius.group,
  },
  dangerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 48,
    paddingHorizontal: space.xs,
  },
  stats: { flexDirection: "row", gap: 6 },
  stat: { flex: 1, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 2 },
  statLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
});
