/**
 * 模型：上面是配好的模型（导演那一行带“导演”标记），下面是添加模型的表单（AddModelForm）。
 * Key 只在添加时输入一次，经 TLS 发给服务端加密保存；之后界面只显示后四位，设备上不保存。
 * 服务器有官方模型时，列表上面是官方模型的余额；官方模型被删掉了，可以在这里加回来。
 * 路由页面是 app/settings/models.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { creditsLine, modelMeta, modelStatusLabel, modelTitle, statusKind } from "@bettertavern/core/settings/labels";

import { ProviderMark } from "../../../components/KeyParts.tsx";
import {
  ErrorState,
  Group,
  Icon,
  Loading,
  Notice,
  Pill,
  SectionHeader,
  Status,
  useColumnStyle,
  useOverlay,
} from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { font, space, usePalette } from "../../../theme/index.ts";
import { AddModelForm } from "../AddModelForm.tsx";
import { SettingsBack, useSettingsNav } from "../nav.tsx";

function ModelRow({ route, onPress }: { route: ModelRoute; onPress: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(route.is_director ? "models.rowLabelDirector" : "models.rowLabel", {
        name: modelTitle(route),
      })}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : "transparent" }]}
    >
      <ProviderMark provider={route.provider} tone={route.is_director ? "ink" : "card"} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: modelTitle(route) === route.model ? font.mono : undefined,
            fontSize: modelTitle(route) === route.model ? 15 : 16,
            lineHeight: 22,
            fontWeight: "500",
            color: palette.ink,
          }}
        >
          {modelTitle(route)}
        </Text>
        <View style={styles.meta}>
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontFamily: font.mono, fontSize: 12, color: palette.mut }}
          >
            {modelMeta(route)}
          </Text>
          <Status kind={statusKind(route.status)} label={modelStatusLabel(route.status)} />
        </View>
      </View>
      {route.source === "platform" ? <Pill label={t("models.officialPill")} height={26} /> : null}
      {route.is_background ? <Pill label={t("models.backgroundPill")} height={26} /> : null}
      {route.is_workbench ? <Pill label={t("models.workbenchPill")} height={26} /> : null}
      {route.is_director ? (
        <Pill label={t("models.directorPill")} tone="acc" height={26} />
      ) : (
        <Icon name="chevronRight" size={18} color={palette.mut} />
      )}
    </Pressable>
  );
}

export function ModelsBody() {
  const { api } = useApp();
  const nav = useSettingsNav();
  const column = useColumnStyle();
  const palette = usePalette();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [addError, setAddError] = useState<unknown>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [providers, routes, credits] = await Promise.all([
      api.models.providers(),
      api.models.list(),
      // 余额取不到不影响模型列表
      api.auth.credits().catch(() => null),
    ]);
    return { providers, routes, credits };
  }, [api]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <SettingsBack />
        <ErrorState
          title={t("models.loadFailed")}
          message={describeError(error)}
          onRetry={() => void reload()}
        />
      </View>
    );
  }
  const { providers, routes, credits } = data;
  const platform = credits?.platform === true;
  const addPlatform = async (): Promise<void> => {
    setAddError(null);
    try {
      await api.models.addPlatform();
      overlay.toast(t("models.officialAdded"));
      void reload();
    } catch (e) {
      setAddError(e);
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            {t("models.title")}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>
            {platform ? t("models.introPlatform") : t("models.intro")}
          </Text>
        </View>
        {platform && credits ? (
          <Notice
            tone={credits.balance > 0 ? "info" : "warn"}
            message={creditsLine(credits)}
            actionLabel={routes.some((r) => r.source === "platform") ? undefined : t("models.officialUse")}
            onAction={routes.some((r) => r.source === "platform") ? undefined : () => void addPlatform()}
            style={styles.notice}
          />
        ) : null}
        {addError ? <Notice message={describeError(addError)} style={styles.notice} /> : null}
        {error ? (
          <Notice
            icon="offline"
            message={describeError(error)}
            actionLabel={t("common.retry")}
            onAction={() => void reload()}
            style={styles.inset}
          />
        ) : null}
        {routes.length > 0 ? (
          <Group style={styles.inset}>
            {routes.map((r) => (
              <ModelRow key={r.id} route={r} onPress={() => nav.open({ screen: "model", id: r.id })} />
            ))}
          </Group>
        ) : null}
        <SectionHeader title={t("models.add")} />
        {providers.length > 0 ? (
          <AddModelForm
            providers={providers}
            routes={routes}
            onAdded={(created) => {
              void reload();
              nav.open({ screen: "model", id: created.id });
            }}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: 18, gap: space.s },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  inset: { marginHorizontal: space.list },
  notice: { marginHorizontal: space.list, marginBottom: space.m, borderRadius: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 72, padding: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
});
