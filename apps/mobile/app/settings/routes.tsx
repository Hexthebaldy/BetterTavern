/**
 * 导演模型：写故事用的模型，“能记住多少”的格子图，工作窗口上限（服务端按模型的上下文长度校验）和思考开关。
 * 换模型在“密钥与端点”里选；最底下可以取消导演模型。
 */

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { ModelRoute } from "../../src/api/types.ts";
import { ProviderMark } from "../../src/components/KeyParts.tsx";
import {
  BackBar,
  Button,
  ErrorState,
  Icon,
  Loading,
  Notice,
  Page,
  SectionHeader,
  Segmented,
  Toggle,
  useOverlay,
} from "../../src/components/ui.tsx";
import { CREDENTIAL_STATUS, credentialTitle, providerMark } from "../../src/features/settings/labels.ts";
import {
  choiceTokens,
  WINDOW_CHOICES,
  windowBlocks,
  windowChoice,
  type WindowChoice,
} from "../../src/features/settings/window.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, space, usePalette } from "../../src/theme/index.ts";
import { formatTokens } from "../../src/utils/format.ts";

const COLUMNS = 16;
const GAP = 4;

/** “能记住多少”：一张灰卡，里面一块白色面板，每个圆点是一格（默认 4K） */
function MemoryBlocks({ route, choice }: { route: ModelRoute; choice: WindowChoice }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  // 按屏幕宽度算出圆点直径（百分比宽度加 aspectRatio 在换行容器里会让布局反复计算）
  const inner = width - space.list * 2 - space.l * 2 - 14 * 2;
  const cell = Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);
  const w = windowBlocks(route.window.model_window, choiceTokens(choice), route.window.max_tokens);
  const k = formatTokens;
  const legend = (swatch: object, label: string) => (
    <View style={styles.legend}>
      <View style={[styles.swatch, swatch]} />
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: palette.ink2 }}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.memory, { backgroundColor: palette.bg2 }]}>
      <View style={styles.memoryTitle}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: palette.ink }}>
          能记住多少
        </Text>
        <Text style={{ fontFamily: font.mono, fontSize: 12.5, color: palette.mut }}>
          上下文 {k(route.window.model_window)}
        </Text>
      </View>
      <View
        style={[styles.blocks, { backgroundColor: palette.card }]}
        accessibilityRole="image"
        accessibilityLabel={`上下文 ${k(route.window.model_window)}，故事 ${k(w.story)}，每轮输出 ${k(route.window.max_tokens)}，不使用 ${k(w.free)}`}
      >
        {w.blocks.map((b, i) => (
          <View
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: cell / 2,
              backgroundColor: b === "story" ? palette.ink : b === "output" ? palette.acc : palette.bg3,
              boxShadow:
                i === w.mark ? `0 0 0 2.5px ${palette.card}, 0 0 0 4.5px ${palette.warn}` : undefined,
            }}
          />
        ))}
      </View>
      <View style={styles.legends}>
        {legend({ backgroundColor: palette.ink }, `故事 ${k(w.story)}`)}
        {legend({ backgroundColor: palette.acc }, `每轮输出 ${k(route.window.max_tokens)}`)}
        {legend({ backgroundColor: palette.bg3 }, `不使用 ${k(w.free)}`)}
        {legend({ boxShadow: `inset 0 0 0 2.5px ${palette.warn}` }, "开始压缩")}
      </View>
      <Text style={{ fontSize: 14, lineHeight: 23, color: palette.ink2 }}>
        每个圆点是 {k(w.unit)}。模型最多能读 {k(route.window.model_window)}，你给导演 {k(w.used)}：每轮最多写{" "}
        {k(route.window.max_tokens)}，剩下约 {k(w.story)} 用来记前情和世界状态。
      </Text>
    </View>
  );
}

export default function RoutesScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { data, error, loading, refreshing, reload, refresh, setData } = useAsync(async () => {
    const [routes, credentials, providers] = await Promise.all([
      api.routes.list(),
      api.credentials.list(),
      api.credentials.providers(),
    ]);
    return { director: routes.find((r) => r.task === "director") ?? null, credentials, providers };
  }, [api]);
  const [choice, setChoice] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const director = data?.director ?? null;
  useEffect(() => {
    if (!director) return;
    setChoice(windowChoice(director.params.working_window));
    setThinking(director.params.thinking === true);
  }, [director]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <BackBar />
        <ErrorState title="导演模型没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }

  const save = async (): Promise<void> => {
    if (!director) return;
    setSaving(true);
    setMessage(null);
    try {
      const params = { ...director.params, thinking } as ModelRoute["params"];
      if (choice === "default") delete params.working_window;
      else params.working_window = Number(choice);
      const route = await api.routes.put("director", {
        credential_id: director.credential_id,
        model: director.model,
        params,
        caps_override: director.caps_override,
        fallback_route_id: director.fallback_route_id,
      });
      setData((current) => (current ? { ...current, director: route } : current));
      overlay.toast("已保存");
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "取消导演模型？",
      message: "取消后，新的回合会因为没有模型而无法生成，直到再选一个。",
      confirmLabel: "取消导演模型",
      cancelLabel: "保留",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.routes.remove("director");
      setData((current) => (current ? { ...current, director: null } : current));
      overlay.toast("已取消导演模型");
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    }
  };

  const { credentials, providers } = data;
  if (!director) {
    return (
      <Page header={<BackBar />} refreshing={refreshing} onRefresh={() => void refresh()}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            导演模型
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>
            导演负责写每一段故事和两个选项。先选一个密钥，再从里面挑一个模型。
          </Text>
        </View>
        {credentials.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/settings/credential/[id]", params: { id: c.id } })}
            style={({ pressed }) => [
              styles.keyRow,
              {
                backgroundColor: pressed ? palette.bg3 : palette.bg2,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <ProviderMark mark={providerMark(c.provider)} tone="ink" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: palette.ink }}>
                {credentialTitle(c, providers)}
              </Text>
              <Text style={{ fontSize: 13, color: palette.mut }}>
                尾号 {c.key_last4} · {CREDENTIAL_STATUS[c.status]}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={palette.mut} />
          </Pressable>
        ))}
        <View style={{ padding: space.list }}>
          <Button
            label="添加密钥"
            variant={credentials.length > 0 ? "secondary" : "primary"}
            icon="plus"
            onPress={() => router.push("/settings/credentials")}
          />
        </View>
      </Page>
    );
  }

  const credential = credentials.find((c) => c.id === director.credential_id);
  const dirty =
    windowChoice(director.params.working_window) !== choice ||
    (director.params.thinking === true) !== thinking;
  const clamped = choiceTokens(choice) > director.window.model_window;
  return (
    <Page header={<BackBar />} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={[styles.head, { gap: 10 }]}>
        <Text style={{ fontSize: 13, color: palette.mut }}>导演模型</Text>
        <Text accessibilityRole="header" style={[styles.model, { color: palette.ink }]}>
          {director.model}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({ pathname: "/settings/credential/[id]", params: { id: director.credential_id } })
          }
          style={({ pressed }) => [
            styles.credential,
            { backgroundColor: pressed ? palette.bg3 : palette.bg2 },
          ]}
        >
          <ProviderMark mark={providerMark(director.provider)} size={28} tone="ink" />
          <Text style={{ fontSize: 13.5, color: palette.ink2 }}>
            {director.credential_label || director.provider}
            {credential ? <Text style={{ fontFamily: font.mono }}> · {credential.key_last4}</Text> : null}
          </Text>
        </Pressable>
      </View>

      <MemoryBlocks route={director} choice={choice} />
      <SectionHeader title="工作窗口上限" />
      <View style={{ paddingHorizontal: space.list, gap: 10 }}>
        <Segmented
          value={choice}
          options={WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
          onChange={setChoice}
          mono
          height={52}
        />
        <Text style={{ fontSize: 13, lineHeight: 20, color: palette.mut, paddingHorizontal: space.m }}>
          窗口越大，导演记得越多，但每轮更慢、更贵。用到 80% 时，早期剧情会被压缩成摘要。
        </Text>
        {clamped ? (
          <Notice
            tone="warn"
            message={`这个模型只有 ${formatTokens(director.window.model_window)} 上下文，工作窗口会按 ${formatTokens(director.window.model_window)} 算。`}
          />
        ) : null}
      </View>

      <SectionHeader title="写法" />
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: thinking }}
        accessibilityLabel="深度思考"
        onPress={() => setThinking((t) => !t)}
        style={[styles.switchRow, { backgroundColor: palette.bg2 }]}
      >
        <View style={[styles.switchIcon, { backgroundColor: palette.card }]}>
          <Icon name="bulb" size={20} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 16, color: palette.ink }}>深度思考</Text>
          <Text style={{ fontSize: 13, lineHeight: 20, color: palette.mut }}>模型支持时先思考再写，更慢</Text>
        </View>
        <Toggle value={thinking} onChange={setThinking} label="深度思考" />
      </Pressable>

      <View style={styles.bottom}>
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        <Button
          label={dirty ? "保存" : "保存 · 没有改动"}
          onPress={() => void save()}
          busy={saving}
          disabled={!dirty}
        />
        <Button
          label="换一个模型"
          variant="secondary"
          icon="swap"
          onPress={() => router.push("/settings/credentials")}
        />
        <Button
          label="取消导演模型"
          variant="text"
          onPress={() => void cancel()}
          style={{ marginTop: space.xs }}
        >
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.err }}>取消导演模型</Text>
        </Button>
        <Text style={{ fontSize: 13, lineHeight: 20, color: palette.mut, textAlign: "center" }}>
          取消后，新的回合会因为没有模型而无法生成。
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: 18, gap: space.s },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  model: { fontFamily: font.monoMedium, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  credential: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 36,
    paddingLeft: space.xs,
    paddingRight: 14,
    borderRadius: 18,
  },
  memory: {
    marginHorizontal: space.list,
    paddingVertical: 18,
    paddingHorizontal: space.l,
    borderRadius: 30,
    gap: 14,
  },
  memoryTitle: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  blocks: { flexDirection: "row", flexWrap: "wrap", gap: GAP, padding: 14, borderRadius: 22 },
  legends: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: space.s },
  legend: { flexDirection: "row", alignItems: "center", gap: space.s },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 76,
    marginHorizontal: space.list,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
    borderRadius: 26,
  },
  switchIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  bottom: { paddingHorizontal: space.list, paddingTop: space.xl, gap: space.s },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 72,
    marginHorizontal: space.list,
    marginBottom: space.s,
    padding: 14,
    borderRadius: 26,
  },
});
