/**
 * 一个模型的详情：服务商、Key、状态、端点；测试这个模型、设为导演；“能记住多少”的格子图和窗口来源说明
 * （拿不到窗口时可以手填）；工作窗口上限和深度思考；底部更换 Key、取消导演、删除。面板见 ModelSheets.tsx。
 * 路由页面是 app/settings/model/[id].tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";
import {
  MODEL_STATUS,
  describeWindow,
  modelTitle,
  providerName,
  statusKind,
  windowNote,
} from "@bettertavern/core/settings/labels";
import {
  choiceTokens,
  WINDOW_CHOICES,
  windowChoice,
  type WindowChoice,
} from "@bettertavern/core/settings/window";

import {
  Button,
  ErrorState,
  Icon,
  IconButton,
  Loading,
  Notice,
  Pill,
  SectionHeader,
  Segmented,
  Status,
  Toggle,
  useColumnStyle,
  useOverlay,
} from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { font, space, usePalette } from "../../../theme/index.ts";
import { MemoryBlocks } from "../MemoryBlocks.tsx";
import { EditSheet, ReplaceKeySheet, WindowSheet } from "../ModelSheets.tsx";
import { SettingsBack, useSettingsNav } from "../nav.tsx";
import { ProbeResults } from "../ProbeResults.tsx";

type Message = { tone: "error" | "info"; text: string };

export function ModelBody({ id }: { id: string }) {
  const { api } = useApp();
  const nav = useSettingsNav();
  const column = useColumnStyle();
  const palette = usePalette();
  const overlay = useOverlay();
  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [route, providers] = await Promise.all([api.models.get(id), api.models.providers()]);
    return { route, providers };
  }, [api, id]);

  const [choice, setChoice] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sheet, setSheet] = useState<"edit" | "key" | "window" | null>(null);

  const route = data?.route;
  useEffect(() => {
    if (!route) return;
    setChoice(windowChoice(route.params.working_window));
    setThinking(route.params.thinking === true);
  }, [route]);

  if (loading && !data) return <Loading />;
  if (!data || !route) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <SettingsBack />
        <ErrorState title="模型没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  const { providers } = data;
  const provider = providers.find((p) => p.id === route.provider);

  const update = (fresh: ModelRoute): void =>
    setData((current) => (current ? { ...current, route: fresh } : current));

  const run = async (work: () => Promise<void>): Promise<void> => {
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    }
  };

  const probe = (): Promise<void> =>
    run(async () => {
      setProbing(true);
      try {
        await api.models.probe(route.id);
        // 测试结果存在模型上（last_probe），状态也可能变了：重新取一次
        update(await api.models.get(route.id));
      } finally {
        setProbing(false);
      }
    });

  const makeDirector = (): Promise<void> =>
    run(async () => {
      const fresh = await api.models.update(route.id, { director: true });
      update(fresh);
      const [first] = describeWindow(fresh.window);
      setMessage({ tone: "info", text: `已设为导演模型。${first ?? ""}` });
    });

  const saveParams = (): Promise<void> =>
    run(async () => {
      setSaving(true);
      try {
        const params = { ...route.params, thinking };
        if (choice === "default") delete params.working_window;
        else params.working_window = Number(choice);
        update(await api.models.update(route.id, { params }));
        overlay.toast("已保存");
      } finally {
        setSaving(false);
      }
    });

  const cancelDirector = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "取消导演模型？",
      message: "取消后，新的回合会因为没有模型而无法生成，直到再选一个。",
      confirmLabel: "取消导演模型",
      cancelLabel: "保留",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      update(await api.models.update(route.id, { director: false }));
      overlay.toast("已取消导演模型");
    });
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "删除这个模型？",
      message: route.is_director
        ? "它是现在的导演。删除后新的回合没法生成，直到再选一个导演。"
        : "删除后要用它得重新添加。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await api.models.remove(route.id);
      overlay.toast(`已删除“${modelTitle(route)}”`);
      nav.back();
    });
  };

  const kind = statusKind(route.status);
  const statusColor = kind === "ok" ? palette.ok : kind === "invalid" ? palette.err : palette.warn;
  const dirty =
    windowChoice(route.params.working_window) !== choice || (route.params.thinking === true) !== thinking;
  const clamped = choiceTokens(choice) > route.window.model_window;
  const note = windowNote(route.window);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={{ flex: 1, gap: space.s }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: palette.ink }, route.label ? null : styles.mono]}
            >
              {modelTitle(route)}
            </Text>
            <View style={styles.statusLine}>
              <Status kind={kind} label={MODEL_STATUS[route.status]} />
              {route.is_director ? <Pill tone="acc" label="导演" /> : null}
            </View>
          </View>
          <IconButton
            icon="write"
            label="编辑备注名、模型名和端点"
            size={20}
            diameter={44}
            onPress={() => setSheet("edit")}
          />
        </View>
        <View style={styles.grid}>
          {[
            ["服务商", providerName(route.provider, providers), false],
            ["Key", `•••• ${route.key_last4}`, true],
            ["模型", route.model, true],
            ["端点", route.base_url ?? "官方地址", !!route.base_url],
          ].map(([key, value, mono]) => (
            <View key={String(key)} style={[styles.cell, { backgroundColor: palette.bg2 }]}>
              <Text style={[styles.cellKey, { color: palette.mut }]}>{key}</Text>
              <Text
                numberOfLines={1}
                style={[
                  { fontSize: 15, color: palette.ink },
                  mono ? { fontFamily: font.mono, fontSize: 14 } : null,
                ]}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>
        {route.status !== "ok" ? (
          <Text style={[styles.hint, { color: statusColor }]}>
            {route.status === "invalid"
              ? "服务商拒绝了这个 Key，请更换 Key。"
              : "还没确认这个 Key 能用：测试一下这个模型就知道了。"}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="测试这个模型"
            variant="secondary"
            onPress={() => void probe()}
            busy={probing}
            style={styles.action}
          >
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "500", color: palette.ink }}>测试这个模型</Text>
              <Text style={{ fontFamily: font.mono, fontSize: 10.5, color: palette.mut }}>约 30 秒</Text>
            </View>
          </Button>
          {route.is_director ? null : (
            <Button label="设为导演模型" onPress={() => void makeDirector()} style={styles.action} />
          )}
        </View>
        {message ? (
          <Notice
            tone={message.tone}
            message={message.text}
            style={{ marginHorizontal: space.list, marginTop: space.s, borderRadius: 22 }}
          />
        ) : null}
        {route.last_probe ? <ProbeResults report={route.last_probe} /> : null}

        <SectionHeader title="上下文" />
        <MemoryBlocks route={route} choice={choice} />
        {note ? (
          <Notice
            tone={route.window.source === "learned" ? undefined : "warn"}
            message={note}
            actionLabel={route.window.source === "learned" ? undefined : "填写"}
            onAction={route.window.source === "learned" ? undefined : () => setSheet("window")}
            style={{ marginHorizontal: space.list, marginTop: space.s, borderRadius: 22 }}
          />
        ) : null}

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
              message={`这个模型只有 ${formatTokens(route.window.model_window)} 上下文，工作窗口会按 ${formatTokens(route.window.model_window)} 算。`}
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
            <Text style={{ fontSize: 13, lineHeight: 20, color: palette.mut }}>
              模型支持时先思考再写，更慢
            </Text>
          </View>
          <Toggle value={thinking} onChange={setThinking} label="深度思考" />
        </Pressable>
        <View style={{ paddingHorizontal: space.list, paddingTop: space.l }}>
          <Button
            label={dirty ? "保存" : "保存 · 没有改动"}
            onPress={() => void saveParams()}
            busy={saving}
            disabled={!dirty}
          />
        </View>

        <View style={styles.bottom}>
          <Button label="更换 Key" variant="secondary" icon="key" onPress={() => setSheet("key")} />
          {route.is_director ? (
            <Button label="取消导演模型" variant="text" onPress={() => void cancelDirector()}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: palette.err }}>取消导演模型</Text>
            </Button>
          ) : null}
          <Button label="删除模型" variant="danger" icon="trash" onPress={() => void remove()} />
        </View>
      </ScrollView>
      <EditSheet
        visible={sheet === "edit"}
        onClose={() => setSheet(null)}
        route={route}
        provider={provider}
        onSaved={update}
      />
      <ReplaceKeySheet
        visible={sheet === "key"}
        onClose={() => setSheet(null)}
        route={route}
        onSaved={(fresh) => {
          update(fresh);
          setMessage({ tone: "info", text: `Key 已更换，尾号 ${fresh.key_last4}` });
        }}
      />
      <WindowSheet
        visible={sheet === "window"}
        onClose={() => setSheet(null)}
        route={route}
        onSaved={update}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, minHeight: 60, paddingHorizontal: space.s },
  actions: { flexDirection: "row", gap: space.s, paddingHorizontal: space.list, paddingTop: 10 },
  bottom: { paddingHorizontal: space.list, paddingTop: space.xl, gap: space.s },
  cell: {
    width: "48.9%",
    flexGrow: 1,
    paddingVertical: 14,
    paddingHorizontal: space.l,
    gap: 2,
    borderRadius: 22,
  },
  cellKey: { fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: space.list },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s,
    paddingLeft: space.page,
    paddingRight: space.l,
    paddingTop: space.l,
    paddingBottom: space.l,
  },
  hint: { fontSize: 13, lineHeight: 20, paddingHorizontal: space.page, paddingTop: space.s },
  mono: { fontFamily: font.monoMedium, fontSize: 24, letterSpacing: -0.4 },
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
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
  title: { fontSize: 28, lineHeight: 36, fontWeight: "700", letterSpacing: -0.56 },
});
