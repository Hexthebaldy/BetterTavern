/**
 * 账户：邮箱、昵称、注册日期，修改密码（折叠着），退出登录；删除账户放在最底下，展开后先列出会被删掉的东西，再输入密码确认。
 * 路由页面是 app/settings/account.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import { formatDate } from "@bettertavern/core/utils/format";

import {
  Button,
  Field,
  Group,
  Icon,
  Notice,
  useColumnStyle,
  useOverlay,
  type IconName,
} from "../../../components/ui.tsx";
import { legalUrl } from "../../auth/parts.tsx";
import { SettingsBack } from "../nav.tsx";
import { useApp } from "../../../state/AppProvider.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  hardShadow,
  space,
  useComic,
} from "../../../theme/index.ts";

type Counts = { stories: number; scenarios: number; models: number };

const MIN_PASSWORD = 8;

/** 修改密码：改完其他设备退出，这台设备换上新令牌（同网页端的 ChangePassword） */
function ChangePassword() {
  const { api, signIn } = useApp();
  const c = useComic();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!current || next.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.changePassword({ current_password: current, new_password: next }));
      setCurrent("");
      setNext("");
      setOpen(false);
      overlay.toast(t("account.passwordChanged"), { icon: "check" });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.fold, { backgroundColor: c.paper, borderColor: c.ink }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.dangerHead}
      >
        <Icon name="key" size={20} color={c.ink} />
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: c.ink }}>
          {t("account.changePassword")}
        </Text>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={18} color={c.ink} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.m }}>
          {error ? <Notice message={error} /> : null}
          <Field
            label={t("account.currentPassword")}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
          />
          <Field
            label={t("account.newPassword")}
            placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={() => void submit()}
          />
          <Button
            label={t("account.changePassword")}
            onPress={() => void submit()}
            busy={busy}
            disabled={!current || next.length < MIN_PASSWORD}
          />
        </View>
      ) : null}
    </View>
  );
}

/** 账户页底部的协议链接（在浏览器里打开网页端的页面） */
function LegalLinks() {
  const { serverUrl } = useApp();
  const c = useComic();
  const { t } = useTranslation();
  return (
    <View style={styles.legal} accessibilityLabel={t("legal.nav")}>
      {(["terms", "privacy", "rules"] as const).map((page) => (
        <Pressable
          key={page}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(legalUrl(serverUrl, page))}
          hitSlop={6}
          style={styles.legalLink}
        >
          <Text style={{ fontSize: 13, color: c.mut, textDecorationLine: "underline" }}>
            {t(`legal.${page}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AccountBody() {
  const { api, user, signOut } = useApp();
  const column = useColumnStyle();
  const c = useComic();
  const overlay = useOverlay();
  const { t } = useTranslation();
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
      Promise.all([api.playthroughs.list(), api.scenarios.list(), api.models.list()])
        .then(([stories, scenarios, models]) =>
          setCounts({ stories: stories.length, scenarios: scenarios.length, models: models.length }),
        )
        .catch(() => undefined);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("account.deleteTitle"),
      message: t("account.deleteMessage"),
      confirmLabel: t("account.deleteAccount"),
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
      style={[styles.stat, { backgroundColor: c.paper, borderColor: c.ink }]}
      accessibilityLabel={`${label} ${value ?? ""}`}
    >
      <Text style={{ fontFamily: font.monoMedium, fontSize: 17, color: c.ink }}>{value ?? "–"}</Text>
      <View style={styles.statLabel}>
        <Icon name={icon} size={13} color={c.mut} />
        <Text style={{ fontSize: 12.5, color: c.mut }}>{label}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[styles.content, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: c.acc, borderColor: c.ink, boxShadow: hardShadow(c.ink, comicDepth.raised) },
            ]}
          >
            <Text style={{ fontSize: 40, fontWeight: "900", color: c.onAcc }}>{[...name][0] ?? "?"}</Text>
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.name, { color: c.ink }]}>
              {name}
            </Text>
            {joined ? (
              <Text style={{ fontSize: 12.5, color: c.mut }}>
                {t("account.joined", { date: joined })}
              </Text>
            ) : null}
          </View>
        </View>
        <Group>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: c.mut }]}>{t("account.email")}</Text>
            <Text style={{ flex: 1, fontSize: 15, color: c.ink }} selectable>
              {user?.email}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: c.mut }]}>{t("account.nickname")}</Text>
            <Text style={{ flex: 1, fontSize: 15, color: user?.display_name ? c.ink : c.mut }}>
              {user?.display_name || t("account.notSet")}
            </Text>
          </View>
        </Group>
        <ChangePassword />
        <Button
          label={t("account.signOut")}
          variant="secondary"
          icon="logout"
          onPress={() => void signOut()}
        />

        <LegalLinks />
        <View style={[styles.danger, { backgroundColor: c.paper, borderColor: c.err }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={toggle}
            style={styles.dangerHead}
          >
            <Icon name="alert" size={20} color={c.err} />
            <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: c.err }}>
              {t("account.deleteAccount")}
            </Text>
            <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={c.err} />
          </Pressable>
          {expanded ? (
            <View style={{ gap: space.m }}>
              <View style={styles.stats}>
                {stat("story", counts?.stories, t("account.saves"))}
                {stat("library", counts?.scenarios, t("account.scenarios"))}
                {stat("key", counts?.models, t("account.models"))}
              </View>
              <Text
                style={{ fontSize: 14, lineHeight: 22, color: c.ink2, paddingHorizontal: space.xs }}
              >
                {t("account.deleteMessage")}
              </Text>
              {error ? <Notice message={error} /> : null}
              <Field
                label={t("account.confirmPassword")}
                hideLabel
                placeholder={t("account.confirmPassword")}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
              />
              <Button
                label={t("account.deleteAccount")}
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
  content: { paddingHorizontal: 20, paddingBottom: 56, gap: space.m },
  head: { alignItems: "center", gap: 10, paddingTop: space.page, paddingBottom: 14 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: comicStroke.frame,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 26, lineHeight: 32, fontWeight: "900" },
  kv: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 56, paddingHorizontal: 14 },
  /** 标签一列：中文两个字、英文的 Nickname 都放得下，值对齐 */
  key: { width: 72, fontSize: 13.5, fontWeight: "700" },
  legal: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: space.l, marginTop: space.s },
  legalLink: { minHeight: 32, justifyContent: "center" },
  fold: {
    paddingTop: space.s,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  /** 删除账户：红框的格子 */
  danger: {
    marginTop: 20,
    paddingTop: space.s,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  dangerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 48,
    paddingHorizontal: space.xs,
  },
  stats: { flexDirection: "row", gap: space.s },
  stat: {
    flex: 1,
    height: 64,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  statLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
});
