/**
 * 剧本详情：封面、角色卡概要、原卡的开场白，下面是“开始新的故事”的五步表单。
 * 开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 * 右上角“更多”里可以重命名、删除剧本；删除按钮也在页面最底下。
 *
 * 平板（theme/layout.ts）：中屏单栏，宽 640，居中。宽屏两栏（设计稿 T12），两栏各自滚动：
 * 左栏宽 420 是封面（高 236，返回和“更多”浮在上面）、名字、标签、统计、简介、原卡开场白；
 * 右栏是开始新故事的五步，底部浮着一条摘要栏（已选项胶囊加“开始故事”），圆角 34，带投影。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "../../src/api/client.ts";
import type { Scenario } from "../../src/api/types.ts";
import { Cover } from "../../src/components/Cover.tsx";
import {
  BackBar,
  Button,
  ErrorState,
  Icon,
  IconButton,
  Loading,
  Notice,
  Pill,
  useColumnStyle,
  useOverlay,
  type IconName,
} from "../../src/components/ui.tsx";
import { StartForm, type StartValues } from "../../src/features/scenario/StartForm.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, radius, size, space, type, usePalette } from "../../src/theme/index.ts";
import { pane } from "../../src/theme/layout.ts";

/** 角色卡里可能被截断的字段 */
const FIELD_NAMES: Record<string, string> = {
  description: "描述",
  personality: "性格",
  scenario: "场景",
  first_mes: "开场白",
  mes_example: "对话示例",
  system_prompt: "系统提示",
  post_history_instructions: "历史后指令",
  creator_notes: "作者备注",
};

function Stat({
  icon,
  value,
  label,
  warn,
}: {
  icon: IconName;
  value: number;
  label: string;
  warn?: boolean;
}) {
  const palette = usePalette();
  const color = warn ? palette.warn : palette.ink;
  return (
    <View style={[styles.stat, { backgroundColor: warn ? palette.warnBg : palette.bg2 }]}>
      <Icon name={icon} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: warn ? palette.warn : palette.mut }}>{label}</Text>
    </View>
  );
}

function Overview({ scenario }: { scenario: Scenario }) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const truncated = scenario.truncated_fields;
  return (
    <>
      <View style={styles.titleBlock}>
        <Text style={[styles.caption, { color: palette.mut }]}>
          角色卡{scenario.creator ? ` · 作者 ${scenario.creator}` : ""}
        </Text>
        <Text accessibilityRole="header" style={[styles.hero, { color: palette.ink }]}>
          {scenario.name}
        </Text>
        {scenario.tags.length > 0 ? (
          <View style={styles.tags}>
            {scenario.tags.slice(0, 8).map((tag) => (
              <Pill key={tag} label={tag} height={30} />
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.stats}>
        <Stat icon="world" value={scenario.book_entries} label="世界书条目" />
        <Stat icon="greeting" value={1 + scenario.alternate_greetings} label="开场白" />
        {truncated.length > 0 ? (
          <Stat icon="truncated" value={truncated.length} label="字段被截断" warn />
        ) : null}
      </View>
      {scenario.description_preview || truncated.length > 0 ? (
        <View style={[styles.card, styles.description, { backgroundColor: palette.bg2 }]}>
          {scenario.description_preview ? (
            <>
              <Text
                numberOfLines={expanded ? undefined : 4}
                onTextLayout={(e) => {
                  if (!expanded) setClamped(e.nativeEvent.lines.length >= 4);
                }}
                selectable
                style={{ fontSize: 15, lineHeight: 26, color: palette.ink2 }}
              >
                {scenario.description_preview}
              </Text>
              {clamped || expanded ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpanded((v) => !v)}
                  style={styles.expand}
                >
                  <Text style={{ fontSize: 14, fontWeight: "500", color: palette.acc }}>
                    {expanded ? "收起" : "展开全文"}
                  </Text>
                  <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} color={palette.acc} />
                </Pressable>
              ) : null}
            </>
          ) : null}
          {truncated.length > 0 ? (
            <View style={[styles.warn, { backgroundColor: palette.card }]}>
              <Icon name="alert" size={16} color={palette.warn} />
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.warn }}>
                {truncated.map((f) => `“${FIELD_NAMES[f] ?? f}”`).join("、")}字段太长，只保留了前面的部分。
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {scenario.first_mes_preview ? (
        <View style={[styles.card, styles.greeting, { backgroundColor: palette.bg2 }]}>
          <Text style={[styles.caption, { color: palette.mut }]}>原卡的开场白</Text>
          <Text
            numberOfLines={3}
            style={{ fontFamily: font.serif, fontSize: 14.5, lineHeight: 25, color: palette.mut }}
          >
            {scenario.first_mes_preview}
          </Text>
        </View>
      ) : null}
    </>
  );
}

export default function ScenarioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const insets = useSafeAreaInsets();
  const { width, expanded } = useLayout();
  const column = useColumnStyle();
  const moreButton = useRef<View>(null);
  // 宽屏右栏底部浮着的摘要栏有多高：表单最后留出这么多
  const [barHeight, setBarHeight] = useState(120);
  const {
    data: scenario,
    error,
    loading,
    reload,
    setData,
  } = useAsync(() => api.scenarios.get(id), [api, id]);
  const [values, setValues] = useState<StartValues | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<Error | null>(null);

  if (loading && !scenario) return <Loading />;
  if (!scenario) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <BackBar />
        <ErrorState title="剧本没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }

  const start = async (): Promise<void> => {
    if (!values?.name) return;
    setStarting(true);
    setStartError(null);
    try {
      const created = await api.playthroughs.create({
        scenario_id: scenario.id,
        protagonist: { name: values.name, summary: values.summary },
        preferences: { length: values.length, style: values.style, boundaries: values.boundaries },
      });
      router.replace({ pathname: "/play/[id]", params: { id: created.playthrough.id } });
    } catch (e) {
      setStartError(e instanceof Error ? e : new Error(describeError(e)));
      setStarting(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: `删除剧本“${scenario.name}”？`,
      message: "已经开始的故事不受影响。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(scenario.id);
      overlay.toast(`已删除“${scenario.name}”`);
      router.back();
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const rename = async (): Promise<void> => {
    const name = await overlay.prompt({
      title: "重命名剧本",
      label: "剧本名",
      initial: scenario.name,
      maxLength: 80,
    });
    if (!name || name === scenario.name) return;
    try {
      const updated = await api.scenarios.rename(scenario.id, name);
      setData(() => updated);
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const more = async (): Promise<void> => {
    const key = await overlay.menu({
      title: scenario.name,
      items: [
        { key: "rename", label: "重命名剧本", icon: "write" },
        { key: "delete", label: "删除剧本", icon: "trash", danger: true },
      ],
      // 平板上贴着“更多”按钮弹出
      anchor: moreButton,
    });
    if (key === "rename") void rename();
    if (key === "delete") void remove();
  };

  const routeMissing = startError instanceof ApiError && startError.code === "ROUTE_MISSING";
  // 封面宽度：手机整屏减两边 12；中屏的居中栏最宽 640；宽屏左栏 420
  const coverWidth = expanded
    ? pane.scenarioInfo
    : Math.min(width, column ? pane.readable : width) - space.list * 2;
  const coverHeight = expanded ? 236 : Math.round(coverWidth * 0.82);

  const cover = (
    <View style={styles.cover}>
      <Cover
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
        width={coverWidth}
        height={coverHeight}
        rounded={34}
      />
      {/* 封面伸到状态栏下面，两个按钮避开刘海和灵动岛 */}
      <View style={[styles.coverBar, { top: Math.max(insets.top - space.list, 0) + space.s }]}>
        <IconButton
          icon="back"
          label="返回"
          tone="card"
          diameter={size.touch}
          onPress={() => router.back()}
        />
        <IconButton
          ref={moreButton}
          icon="more"
          label="更多：重命名、删除"
          tone="card"
          diameter={size.touch}
          onPress={() => void more()}
        />
      </View>
    </View>
  );
  const startHead = (
    <View style={[styles.startHead, expanded ? { paddingTop: insets.top + space.l } : null]}>
      <Text accessibilityRole="header" style={[styles.startTitle, { color: palette.ink }]}>
        开始新的故事
      </Text>
      <Text style={[styles.caption, { color: palette.mut }]}>只有第 1 步必填</Text>
    </View>
  );
  const form = (
    <StartForm
      cardName={scenario.name}
      wide={expanded}
      onChange={(next, parts) => {
        setValues(next);
        setSummary(parts);
      }}
    />
  );
  const startButton = (
    <Button
      label="开始故事"
      trailingIcon="arrowRight"
      between
      onPress={() => void start()}
      busy={starting}
      disabled={!values?.name}
      style={styles.startButton}
    />
  );
  const errorNotice = startError ? (
    <Notice
      message={routeMissing ? "没有可用模型" : describeError(startError)}
      actionLabel={routeMissing ? "去设置" : undefined}
      onAction={routeMissing ? () => router.push("/settings/routes") : undefined}
    />
  ) : null;
  const pills = (
    <View
      style={[styles.summary, expanded ? { flex: 1 } : null]}
      accessible
      accessibilityLabel={`将要开始：${summary.join("，")}`}
    >
      {summary.map((part) => (
        <Pill key={part} label={part} />
      ))}
    </View>
  );
  const danger = (
    <View style={styles.danger}>
      <Button
        label="删除剧本"
        variant="danger"
        icon="trash"
        onPress={() => void remove()}
        style={{ alignSelf: "stretch" }}
      />
      <Text style={[styles.caption, { color: palette.mut }]}>已经开始的故事不受影响。</Text>
    </View>
  );

  if (expanded) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, flexDirection: "row", backgroundColor: palette.bg }}
      >
        <ScrollView
          style={{ width: pane.scenarioInfo + space.list * 2, flexGrow: 0 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
        >
          {cover}
          <Overview scenario={scenario} />
          {danger}
        </ScrollView>
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: barHeight + insets.bottom + space.xl }}
            keyboardShouldPersistTaps="handled"
          >
            {startHead}
            {form}
          </ScrollView>
          <View
            onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
            style={[
              styles.submit,
              styles.floatingBar,
              {
                bottom: Math.max(insets.bottom, space.l),
                backgroundColor: palette.card,
                boxShadow: palette.shadowFloat,
              },
            ]}
          >
            {errorNotice}
            <View style={styles.barRow}>
              {pills}
              {startButton}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <ScrollView
        contentContainerStyle={[{ paddingBottom: insets.bottom + 48 }, column]}
        keyboardShouldPersistTaps="handled"
      >
        {cover}
        <Overview scenario={scenario} />
        {startHead}
        {form}
        <View style={[styles.submit, { backgroundColor: palette.card, boxShadow: palette.shadowFloat }]}>
          {errorNotice}
          {pills}
          {startButton}
        </View>
        {danger}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  cover: { marginTop: space.list, marginHorizontal: space.list },
  coverBar: {
    position: "absolute",
    left: space.m,
    right: space.m,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  titleBlock: { paddingTop: 22, paddingHorizontal: space.page, paddingBottom: space.l, gap: space.m },
  caption: { fontSize: 13, lineHeight: 19 },
  hero: { ...type.hero },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stats: { flexDirection: "row", gap: space.s, paddingHorizontal: space.list },
  stat: { flex: 1, padding: 14, borderRadius: 22, gap: 6 },
  statValue: { fontFamily: font.monoMedium, fontSize: 22, lineHeight: 26 },
  card: {
    marginTop: space.s,
    marginHorizontal: space.list,
    borderRadius: radius.group,
    paddingHorizontal: space.l,
  },
  description: { paddingTop: 18, paddingBottom: space.s },
  expand: { flexDirection: "row", alignItems: "center", gap: 4, height: 44, alignSelf: "flex-start" },
  warn: {
    flexDirection: "row",
    gap: space.s,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: space.m,
    marginHorizontal: -4,
    marginBottom: space.s,
    borderRadius: radius.input,
  },
  greeting: { paddingVertical: 18, gap: 6 },
  startHead: {
    paddingTop: 40,
    paddingBottom: space.l,
    paddingHorizontal: space.page,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s,
  },
  startTitle: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.5 },
  submit: {
    marginTop: space.l,
    marginHorizontal: space.list,
    padding: space.m,
    borderRadius: radius.sheet,
    gap: 10,
  },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: 4 },
  startButton: { height: 56, borderRadius: 28, paddingLeft: space.page, paddingRight: space.s },
  /** 宽屏右栏底部浮着的摘要栏 */
  floatingBar: { position: "absolute", left: 0, right: 0, marginTop: 0, borderRadius: 34 },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  danger: { marginTop: 40, marginHorizontal: space.list, gap: space.s, alignItems: "center" },
});
