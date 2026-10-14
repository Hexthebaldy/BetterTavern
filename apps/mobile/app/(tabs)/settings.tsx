/**
 * 设置首页：最上面是墨色的导演模型卡片（没设置时是一张琥珀色的引导卡），下面两组：配置、其他。
 * “其他”里的“外观”打开主题面板（跟随系统 / 浅色 / 夜间），选了立刻生效。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { Credential, ModelRoute } from "../../src/api/types.ts";
import {
  Button,
  Group,
  GroupLabel,
  Icon,
  LargeHeader,
  ListRow,
  Notice,
  Page,
  Pill,
  RowIcon,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import { CLIENT_VERSION } from "../../src/config.ts";
import { AppearanceSheet } from "../../src/features/settings/AppearanceSheet.tsx";
import { CREDENTIAL_STATUS } from "../../src/features/settings/labels.ts";
import { displayServer } from "../../src/features/settings/servers.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { font, settingLabel, space, usePalette } from "../../src/theme/index.ts";
import { formatTokens } from "../../src/utils/format.ts";

function DirectorCard({
  route,
  credential,
  onPress,
}: {
  route: ModelRoute;
  credential: Credential | undefined;
  onPress: () => void;
}) {
  const palette = usePalette();
  const { model_window: total, working_cap: cap, max_tokens: out } = route.window;
  const used = Math.min(cap, total);
  const story = Math.max(0, used - out) / total;
  const output = Math.min(out, used) / total;
  const faint = { color: palette.bg, opacity: 0.65 };
  const statusDot =
    credential?.status === "ok"
      ? palette.okOnInk
      : credential?.status === "invalid"
        ? palette.err
        : palette.warn;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`导演模型 ${route.model}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.ink, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={[{ fontSize: 13 }, faint]}>导演模型</Text>
        {credential ? (
          <View style={[styles.cardStatus, { backgroundColor: palette.arrowBg }]}>
            <View style={[styles.dot, { backgroundColor: statusDot }]} />
            <Text style={{ fontSize: 12, color: palette.bg }}>{CREDENTIAL_STATUS[credential.status]}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardMain}>
        <View style={[styles.cardIcon, { backgroundColor: palette.arrowBg }]}>
          <Icon name="director" color={palette.bg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.model, { color: palette.bg }]}>
            {route.model}
          </Text>
          <Text numberOfLines={1} style={[{ fontSize: 12.5, lineHeight: 18 }, faint]}>
            {route.credential_label || route.provider}
            {credential ? ` · 尾号 ${credential.key_last4}` : ""}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={palette.bg} />
      </View>
      <View style={{ marginTop: space.l, gap: 6 }}>
        <View style={[styles.bar, { backgroundColor: palette.arrowBg }]} accessibilityElementsHidden>
          <View style={[styles.barPart, { flex: story, backgroundColor: palette.bg }]} />
          <View
            style={[styles.barPart, { flex: output, marginLeft: 2, backgroundColor: palette.accOnInk }]}
          />
          <View style={{ flex: Math.max(0, 1 - story - output) }} />
        </View>
        <View style={styles.cardTop}>
          <Text style={[styles.small, faint]}>工作窗口 {formatTokens(used)}</Text>
          <Text style={[styles.small, faint]}>上下文 {formatTokens(total)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function SetupCard({ hasKey, onPress }: { hasKey: boolean; onPress: () => void }) {
  const palette = usePalette();
  const step = (n: number, label: string, current: boolean, done: boolean) => (
    <View style={[styles.step, current ? { backgroundColor: palette.card } : null]}>
      <View
        style={[
          styles.stepKey,
          current ? { backgroundColor: palette.ink } : { boxShadow: `inset 0 0 0 1.5px ${palette.line2}` },
        ]}
      >
        {done ? (
          <Icon name="check" size={14} color={palette.ok} strokeWidth={2.4} />
        ) : (
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: current ? palette.bg : palette.mut }}>
            {n}
          </Text>
        )}
      </View>
      <Text style={{ fontSize: 15, color: current ? palette.ink : palette.mut }}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.card, styles.setup, { backgroundColor: palette.warnBg }]}>
      <Pill tone="warn" icon="alert" label="还不能开始故事" height={28} />
      <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: palette.ink }}>
        设置导演模型
      </Text>
      <View style={{ gap: 6 }}>
        {step(1, "添加一个密钥", !hasKey, hasKey)}
        {step(2, "从里面挑一个模型", hasKey, false)}
      </View>
      <Button
        label={hasKey ? "挑一个模型" : "添加密钥"}
        trailingIcon="arrowRight"
        between
        onPress={onPress}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { api, user, serverUrl } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { theme } = usePrefs();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { data, error, refreshing, refresh, reload } = useAsync(async () => {
    const [routes, credentials] = await Promise.all([api.routes.list(), api.credentials.list()]);
    return { director: routes.find((r) => r.task === "director") ?? null, credentials };
  }, [api]);

  const bottomSpace = useTabBarSpace();
  const director = data?.director ?? null;
  const credentials = data?.credentials ?? [];
  const name = user?.display_name || user?.email || "账户";
  return (
    <Page
      header={<LargeHeader title="设置" />}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      bottomSpace={bottomSpace}
      contentStyle={{ paddingHorizontal: space.list }}
    >
      {error ? (
        <Notice
          icon="offline"
          message={describeError(error)}
          actionLabel="重试"
          onAction={() => void reload()}
          style={{ marginTop: space.s }}
        />
      ) : null}
      {director ? (
        <DirectorCard
          route={director}
          credential={credentials.find((c) => c.id === director.credential_id)}
          onPress={() => router.push("/settings/routes")}
        />
      ) : data ? (
        <SetupCard
          hasKey={credentials.length > 0}
          onPress={() => router.push(credentials.length > 0 ? "/settings/routes" : "/settings/credentials")}
        />
      ) : null}

      <GroupLabel style={styles.label}>配置</GroupLabel>
      <Group>
        {data && !director ? (
          <ListRow
            key="director"
            title="导演模型"
            subtitle="还没有设置"
            subtitleColor={palette.warn}
            leading={<RowIcon name="director" />}
            onPress={() => router.push("/settings/routes")}
          />
        ) : null}
        <ListRow
          key="keys"
          title="密钥与端点"
          leading={<RowIcon name="key" />}
          trailing={
            data ? (
              credentials.length > 0 ? (
                <View style={[styles.count, { backgroundColor: palette.card }]}>
                  <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.ink }}>
                    {credentials.length}
                  </Text>
                </View>
              ) : (
                <Text style={{ fontSize: 12.5, color: palette.mut }}>还没有添加</Text>
              )
            ) : null
          }
          onPress={() => router.push("/settings/credentials")}
        />
        <ListRow
          key="account"
          title={name}
          subtitle={user?.display_name ? user.email : undefined}
          leading={
            <View style={[styles.avatar, { backgroundColor: palette.accBg }]}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: palette.acc }}>
                {[...name][0] ?? "?"}
              </Text>
            </View>
          }
          onPress={() => router.push("/settings/account")}
        />
      </Group>
      <GroupLabel style={styles.label}>其他</GroupLabel>
      <Group>
        <ListRow
          title="外观"
          leading={<RowIcon name="moon" />}
          trailing={<Text style={{ fontSize: 13, color: palette.mut }}>{settingLabel(theme)}</Text>}
          onPress={() => setAppearanceOpen(true)}
        />
        <ListRow
          title="连接测试"
          subtitle="检查流式输出、断线续传和延迟"
          leading={<RowIcon name="probe" />}
          onPress={() => router.push("/dev/probe")}
        />
      </Group>
      <Text style={[styles.footer, { color: palette.mut }]}>
        v{CLIENT_VERSION} · {displayServer(serverUrl)}
      </Text>
      <AppearanceSheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.s, padding: 18, borderRadius: 30 },
  setup: { gap: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: space.m, marginTop: space.m },
  cardIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  model: { fontFamily: font.monoMedium, fontSize: 17, lineHeight: 24 },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" },
  barPart: { borderRadius: 4 },
  small: { fontFamily: font.mono, fontSize: 11 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 48,
    paddingHorizontal: space.m,
    borderRadius: 18,
  },
  stepKey: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  label: { paddingHorizontal: space.m },
  count: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: space.s,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  footer: {
    paddingVertical: space.l,
    paddingHorizontal: space.m,
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 17,
  },
});
