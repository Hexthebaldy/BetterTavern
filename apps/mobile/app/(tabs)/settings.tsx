/**
 * 设置首页：最上面是导演模型卡片（没设置时是一张琥珀色的引导卡），下面是密钥、账户、连接测试。
 */

import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { Credential, ModelRoute } from "../../src/api/types.ts";
import {
  Button,
  GroupLabel,
  Icon,
  LargeHeader,
  ListRow,
  Notice,
  Page,
  RowIcon,
  Status,
} from "../../src/components/ui.tsx";
import { CLIENT_VERSION } from "../../src/config.ts";
import { CREDENTIAL_STATUS, statusKind } from "../../src/features/settings/labels.ts";
import { displayServer } from "../../src/features/settings/servers.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, space, usePalette } from "../../src/theme/index.ts";
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`导演模型 ${route.model}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? palette.bg3 : palette.bg2, borderColor: palette.line },
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.meta, { color: palette.mut }]}>导演模型</Text>
        {credential ? (
          <Status kind={statusKind(credential.status)} label={CREDENTIAL_STATUS[credential.status]} />
        ) : null}
      </View>
      <View style={styles.cardMain}>
        <View style={[styles.cardIcon, { backgroundColor: palette.ink }]}>
          <Icon name="director" color={palette.bg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.model, { color: palette.ink }]}>
            {route.model}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 18, color: palette.mut }}>
            {route.credential_label || route.provider}
            {credential ? ` · 尾号 ${credential.key_last4}` : ""}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} />
      </View>
      <View style={{ marginTop: space.l, gap: 6 }}>
        <View style={[styles.bar, { backgroundColor: palette.bg3 }]} accessibilityElementsHidden>
          <View style={{ flex: story, backgroundColor: palette.ink }} />
          <View style={{ flex: output, backgroundColor: palette.acc }} />
          <View style={{ flex: Math.max(0, 1 - story - output) }} />
        </View>
        <View style={styles.cardTop}>
          <Text style={[styles.small, { color: palette.mut }]}>工作窗口 {formatTokens(used)}</Text>
          <Text style={[styles.small, { color: palette.mut }]}>上下文 {formatTokens(total)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function SetupCard({ hasKey, onPress }: { hasKey: boolean; onPress: () => void }) {
  const palette = usePalette();
  const step = (n: number, label: string, current: boolean, done: boolean) => (
    <View style={styles.step}>
      <View
        style={[
          styles.stepKey,
          current ? { backgroundColor: palette.ink } : { borderWidth: 1, borderColor: palette.line2 },
        ]}
      >
        {done ? (
          <Icon name="check" size={14} color={palette.ok} strokeWidth={2} />
        ) : (
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: current ? palette.bg : palette.mut }}>
            {n}
          </Text>
        )}
      </View>
      <Text style={{ fontSize: 14, color: current ? palette.ink : palette.mut }}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.card, styles.setup, { backgroundColor: palette.warnBg, borderColor: palette.warn }]}>
      <View style={styles.warnLine}>
        <Icon name="alert" size={18} color={palette.warn} />
        <Text style={[styles.meta, { color: palette.warn }]}>还不能开始故事</Text>
      </View>
      <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: palette.ink }}>
        设置导演模型
      </Text>
      <View style={{ gap: 10 }}>
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
  const { data, error, refreshing, refresh, reload } = useAsync(async () => {
    const [routes, credentials] = await Promise.all([api.routes.list(), api.credentials.list()]);
    return { director: routes.find((r) => r.task === "director") ?? null, credentials };
  }, [api]);

  const director = data?.director ?? null;
  const credentials = data?.credentials ?? [];
  const name = user?.display_name || user?.email || "账户";
  return (
    <Page header={<LargeHeader title="设置" />} refreshing={refreshing} onRefresh={() => void refresh()}>
      {error ? (
        <Notice banner message={describeError(error)} actionLabel="重试" onAction={() => void reload()} />
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

      <GroupLabel style={{ marginTop: space.s }}>配置</GroupLabel>
      {data && !director ? (
        <ListRow
          title="导演模型"
          subtitle="还没有设置"
          subtitleColor={palette.warn}
          leading={<RowIcon name="director" />}
          onPress={() => router.push("/settings/routes")}
        />
      ) : null}
      <ListRow
        title="密钥与端点"
        leading={<RowIcon name="key" />}
        trailing={
          data ? (
            credentials.length > 0 ? (
              <View style={[styles.count, { borderColor: palette.line2 }]}>
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
        title={name}
        subtitle={user?.display_name ? user.email : undefined}
        leading={
          <View style={[styles.avatar, { backgroundColor: palette.accBg }]}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: palette.acc }}>{[...name][0] ?? "?"}</Text>
          </View>
        }
        onPress={() => router.push("/settings/account")}
      />
      <GroupLabel>其他</GroupLabel>
      <ListRow
        title="连接测试"
        subtitle="检查流式输出、断线续传和延迟"
        leading={<RowIcon name="probe" />}
        onPress={() => router.push("/dev/probe")}
      />
      <Text style={[styles.footer, { color: palette.mut }]}>
        v{CLIENT_VERSION}
        {"\n"}
        {displayServer(serverUrl)}
      </Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.page, marginHorizontal: space.page, padding: 18, borderWidth: 1 },
  setup: { gap: space.l },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  meta: { fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.9 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
  cardIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  model: { fontFamily: font.monoMedium, fontSize: 17, lineHeight: 24 },
  bar: { flexDirection: "row", height: 6 },
  small: { fontFamily: font.mono, fontSize: 11 },
  warnLine: { flexDirection: "row", alignItems: "center", gap: space.s },
  step: { flexDirection: "row", alignItems: "center", gap: space.m },
  stepKey: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  count: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  footer: { padding: space.page, fontFamily: font.mono, fontSize: 11, lineHeight: 17, letterSpacing: 0.4 },
});
