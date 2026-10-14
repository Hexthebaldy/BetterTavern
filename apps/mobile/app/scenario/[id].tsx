/**
 * 剧本详情：封面、角色卡概要、原卡的开场白，下面是“开始新的故事”的五步表单。
 * 开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 * 右上角“更多”里可以重命名、删除剧本；删除按钮也在页面最底下。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path } from "react-native-svg";
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
  useOverlay,
  type IconName,
} from "../../src/components/ui.tsx";
import { StartForm, type StartValues } from "../../src/features/scenario/StartForm.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, space, usePalette } from "../../src/theme/index.ts";

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
  last,
}: {
  icon: IconName;
  value: number;
  label: string;
  warn?: boolean;
  last?: boolean;
}) {
  const palette = usePalette();
  const color = warn ? palette.warn : palette.ink;
  return (
    <View style={[styles.stat, last ? null : { borderRightWidth: 1, borderRightColor: palette.line }]}>
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
        <Text style={[styles.meta, { color: palette.mut }]}>
          角色卡{scenario.creator ? ` · 作者 ${scenario.creator}` : ""}
        </Text>
        <Text accessibilityRole="header" style={[styles.hero, { color: palette.ink }]}>
          {scenario.name}
        </Text>
        {scenario.tags.length > 0 ? (
          <View style={styles.tags}>
            {scenario.tags.slice(0, 8).map((tag) => (
              <View key={tag} style={[styles.tag, { borderColor: palette.line2 }]}>
                <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.ink }}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={[styles.stats, { borderColor: palette.line }]}>
        <Stat icon="world" value={scenario.book_entries} label="世界书条目" />
        <Stat
          icon="greeting"
          value={1 + scenario.alternate_greetings}
          label="开场白"
          last={truncated.length === 0}
        />
        {truncated.length > 0 ? (
          <Stat icon="truncated" value={truncated.length} label="字段被截断" warn last />
        ) : null}
      </View>
      <View style={styles.description}>
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
                <Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }}>
                  {expanded ? "收起" : "展开全文"}
                </Text>
                <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} />
              </Pressable>
            ) : null}
          </>
        ) : null}
        {truncated.length > 0 ? (
          <View style={styles.warn}>
            <Icon name="alert" size={16} color={palette.warn} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.warn }}>
              {truncated.map((f) => `“${FIELD_NAMES[f] ?? f}”`).join("、")}字段太长，只保留了前面的部分。
            </Text>
          </View>
        ) : null}
      </View>
      {scenario.first_mes_preview ? (
        <View style={[styles.greeting, { backgroundColor: palette.bg2 }]}>
          <Svg width={22} height={18} viewBox="0 0 22 18">
            <Path d="M0 0h9v9H4v9H0zM13 0h9v9h-5v9h-4z" fill={palette.line2} />
          </Svg>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.meta, { color: palette.mut }]}>原卡的开场白</Text>
            <Text
              numberOfLines={3}
              style={{ fontFamily: font.serif, fontSize: 14.5, lineHeight: 25, color: palette.mut }}
            >
              {scenario.first_mes_preview}
            </Text>
          </View>
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
  const { width } = useWindowDimensions();
  const {
    data: scenario,
    error,
    loading,
    reload,
    setData,
  } = useAsync(() => api.scenarios.get(id), [api, id]);
  const [values, setValues] = useState<StartValues | null>(null);
  const [line, setLine] = useState("");
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
    });
    if (key === "rename") void rename();
    if (key === "delete") void remove();
  };

  const routeMissing = startError instanceof ApiError && startError.code === "ROUTE_MISSING";
  const coverHeight = Math.round(width * 0.62) + insets.top;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} keyboardShouldPersistTaps="handled">
        <View style={{ borderBottomWidth: 1, borderBottomColor: palette.ink }}>
          <Cover seed={scenario.id} blobId={scenario.avatar_blob_id} width={width} height={coverHeight} />
          <View style={[styles.coverBar, { top: insets.top + space.s }]}>
            <IconButton
              icon="back"
              label="返回"
              size={24}
              onPress={() => router.back()}
              style={{ backgroundColor: palette.bg }}
            />
            <IconButton
              icon="more"
              label="更多：重命名、删除"
              onPress={() => void more()}
              style={{ backgroundColor: palette.bg }}
            />
          </View>
        </View>
        <Overview scenario={scenario} />

        <View style={[styles.startHead, { borderTopColor: palette.ink, borderBottomColor: palette.line }]}>
          <Text accessibilityRole="header" style={[styles.startTitle, { color: palette.ink }]}>
            开始新的故事
          </Text>
          <Text style={[styles.meta, { color: palette.mut }]}>5 步 · 只有第 1 步必填</Text>
        </View>
        <StartForm
          cardName={scenario.name}
          onChange={(next, summaryText) => {
            setValues(next);
            setLine(summaryText);
          }}
        />
        <View style={styles.submit}>
          {startError ? (
            <Notice
              message={routeMissing ? "没有可用模型" : describeError(startError)}
              actionLabel={routeMissing ? "去设置" : undefined}
              onAction={routeMissing ? () => router.push("/settings/routes") : undefined}
            />
          ) : null}
          <Text style={[styles.meta, { color: palette.mut }]}>{line}</Text>
          <Button
            label="开始故事"
            trailingIcon="arrowRight"
            between
            onPress={() => void start()}
            busy={starting}
            disabled={!values?.name}
            style={{ minHeight: 56 }}
          />
        </View>

        <View style={[styles.danger, { borderTopColor: palette.line }]}>
          <Button label="删除剧本" variant="danger" icon="trash" onPress={() => void remove()} />
          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.mut }}>已经开始的故事不受影响。</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  coverBar: {
    position: "absolute",
    left: space.m,
    right: space.m,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  titleBlock: { paddingTop: space.read, paddingHorizontal: space.page, paddingBottom: space.page, gap: 14 },
  meta: { fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, letterSpacing: 0.9 },
  hero: { fontSize: 40, lineHeight: 46, fontWeight: "900", letterSpacing: -1.2 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { height: 28, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1 },
  stats: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1 },
  stat: { flex: 1, paddingVertical: 14, paddingLeft: space.page, paddingRight: space.l, gap: 6 },
  statValue: { fontFamily: font.monoMedium, fontSize: 22, lineHeight: 26 },
  description: { padding: space.page, gap: space.s },
  expand: { flexDirection: "row", alignItems: "center", gap: 4, height: 44, alignSelf: "flex-start" },
  warn: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  greeting: { flexDirection: "row", gap: space.m, marginHorizontal: space.page, padding: space.l },
  startHead: {
    marginTop: 40,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: space.page,
    borderTopWidth: 2,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s,
  },
  startTitle: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.5 },
  submit: { padding: space.page, gap: space.m },
  danger: { marginTop: 48, marginHorizontal: space.page, paddingTop: space.page, borderTopWidth: 1, gap: 10 },
});
