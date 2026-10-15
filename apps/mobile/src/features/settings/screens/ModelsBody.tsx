/**
 * 模型：上面是配好的模型（导演那一行带“导演”标记），下面是添加模型的表单（AddModelForm）。
 * Key 只在添加时输入一次，经 TLS 发给服务端加密保存；之后界面只显示后四位，设备上不保存。
 * 路由页面是 app/settings/models.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";
import { MODEL_STATUS, modelTitle, providerMark, statusKind } from "@bettertavern/core/settings/labels";

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
} from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { font, space, usePalette } from "../../../theme/index.ts";
import { AddModelForm } from "../AddModelForm.tsx";
import { SettingsBack, useSettingsNav } from "../nav.tsx";

function ModelRow({ route, onPress }: { route: ModelRoute; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${modelTitle(route)}${route.is_director ? "，导演" : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : "transparent" }]}
    >
      <ProviderMark mark={providerMark(route.provider)} tone={route.is_director ? "ink" : "card"} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: route.label ? undefined : font.mono,
            fontSize: route.label ? 16 : 15,
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
            {route.label ? `${route.model} · ` : ""}•••• {route.key_last4} ·{" "}
            {formatTokens(route.window.model_window)}
          </Text>
          <Status kind={statusKind(route.status)} label={MODEL_STATUS[route.status]} />
        </View>
      </View>
      {route.is_director ? (
        <Pill label="导演" tone="acc" height={26} />
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
  const { data, error, loading, reload } = useAsync(async () => {
    const [providers, routes] = await Promise.all([api.models.providers(), api.models.list()]);
    return { providers, routes };
  }, [api]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <SettingsBack />
        <ErrorState title="模型列表没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  const { providers, routes } = data;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            模型
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>
            故事由你自己的模型来写。添加模型时把 Key 和模型一起配好，再选一个当导演；以后换导演点一下就行。
          </Text>
        </View>
        {error ? (
          <Notice
            icon="offline"
            message={describeError(error)}
            actionLabel="重试"
            onAction={() => void reload()}
            style={styles.inset}
          />
        ) : null}
        {routes.length > 0 ? (
          <Group inset={70} style={styles.inset}>
            {routes.map((r) => (
              <ModelRow key={r.id} route={r} onPress={() => nav.open({ screen: "model", id: r.id })} />
            ))}
          </Group>
        ) : null}
        <SectionHeader title="添加模型" />
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
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 72, padding: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
});
