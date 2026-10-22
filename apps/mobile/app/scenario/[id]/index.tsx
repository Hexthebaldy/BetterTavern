/**
 * 剧本详情：封面、剧本里的角色卡（第一张是主角色，点一下看卡）、剧本设置（默认主角、偏好、开场），
 * 下面是“开始新的故事”的五步表单（按剧本设置预填）。开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 * 剧本名右边是“编辑设置”（form.tsx）；删除剧本的按钮在页面最底下。从编辑页回来时重新加载（useAsync 在回到页面时会再取一次）。
 *
 * 平板（theme/layout.ts）：中屏单栏，宽 640，居中。宽屏两栏（设计稿 T12），两栏各自滚动：
 * 左栏宽 420 是封面（高 236，返回按钮浮在上面）、名字、角色卡、设置、简介；
 * 右栏是开始新故事的五步，底部浮着一条摘要栏（已选项胶囊加“开始故事”），圆角 34，带投影。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { currentLanguage, i18n } from "@bettertavern/core/i18n/index";
import { lengthLabel, splitJoined } from "@bettertavern/core/scenario/startForm";
import { pane } from "@bettertavern/design/layout";

import { Cover } from "../../../src/components/Cover.tsx";
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
} from "../../../src/components/ui.tsx";
import { StartForm, type StartValues } from "../../../src/features/scenario/StartForm.tsx";
import { useAsync } from "../../../src/hooks/useAsync.ts";
import { useLayout } from "../../../src/hooks/useLayout.ts";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { font, radius, size, space, type, usePalette } from "../../../src/theme/index.ts";

/** 开场：导演来写，或者“用‘温九’的第 2 条备选开场白” */
function openingText(scenario: Pick<Scenario, "cards" | "setup">): string {
  const opening = scenario.setup.opening;
  if (!opening) return i18n.t("scenario.openingDirector");
  const card = scenario.cards.find((c) => c.card_id === opening.card_id)?.name ?? "";
  return opening.greeting === 0
    ? i18n.t("scenario.openingGreeting", { card })
    : i18n.t("scenario.openingAlternate", { card, n: opening.greeting });
}

function Overview({ scenario, onEdit }: { scenario: Scenario; onEdit: () => void }) {
  const palette = usePalette();
  const router = useRouter();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const { protagonist, preferences } = scenario.setup;
  const prefs = [
    lengthLabel(preferences.length),
    preferences.style,
    preferences.boundaries ? t("start.avoid", { count: splitJoined(preferences.boundaries).length }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const setupRow = (label: string, value: string) => (
    <View style={styles.setupRow}>
      <Text style={[styles.caption, { color: palette.mut }]}>{label}</Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: palette.ink }}>{value}</Text>
    </View>
  );
  return (
    <>
      <View style={styles.titleBlock}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[styles.hero, { flex: 1, color: palette.ink }]}>
            {scenario.name}
          </Text>
          <Button
            label={t("scenario.editSetup")}
            icon="write"
            variant="secondary"
            onPress={onEdit}
            style={styles.edit}
          />
        </View>
      </View>
      <View style={styles.cast}>
        {scenario.cards.map((card, i) => (
          <Pressable
            key={card.card_id}
            accessibilityRole="button"
            accessibilityHint={t("scenario.openCard")}
            onPress={() => router.push({ pathname: "/card/[id]", params: { id: card.card_id } })}
            style={({ pressed }) => [styles.castRow, { backgroundColor: pressed ? palette.bg3 : palette.bg2 }]}
          >
            <Cover seed={card.card_id} blobId={card.cover_blob_id} width={44} height={44} surface="card" />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: "600", color: palette.ink }}>
              {card.name}
            </Text>
            {i === 0 && scenario.cards.length > 1 ? <Pill label={t("scenario.lead")} tone="acc" /> : null}
            <Icon name="chevronRight" size={16} color={palette.mut} />
          </Pressable>
        ))}
      </View>
      <View style={[styles.card, styles.setup, { backgroundColor: palette.bg2 }]}>
        {setupRow(
          t("scenario.protagonist"),
          protagonist.name
            ? [protagonist.name, protagonist.summary].filter(Boolean).join(" · ")
            : t("scenario.noProtagonist"),
        )}
        {setupRow(t("scenario.preferences"), prefs)}
        {setupRow(t("scenario.opening"), openingText(scenario))}
      </View>
      {scenario.description_preview ? (
        <View style={[styles.card, styles.description, { backgroundColor: palette.bg2 }]}>
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
                {expanded ? t("scenario.collapse") : t("scenario.expand")}
              </Text>
              <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} color={palette.acc} />
            </Pressable>
          ) : null}
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
  const { t } = useTranslation();
  const { width, expanded } = useLayout();
  const column = useColumnStyle();
  // 宽屏右栏底部浮着的摘要栏有多高：表单最后留出这么多
  const [barHeight, setBarHeight] = useState(120);
  const { data: scenario, error, loading, reload } = useAsync(() => api.scenarios.get(id), [api, id]);
  const [values, setValues] = useState<StartValues | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<Error | null>(null);

  if (loading && !scenario) return <Loading />;
  if (!scenario) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <BackBar />
        <ErrorState
          title={t("scenario.loadFailed")}
          message={describeError(error)}
          onRetry={() => void reload()}
        />
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
        // 提示词按当前的界面语言（docs/i18n.md 第 4 节）
        language: currentLanguage(),
      });
      router.replace({ pathname: "/play/[id]", params: { id: created.playthrough.id } });
    } catch (e) {
      setStartError(e instanceof Error ? e : new Error(describeError(e)));
      setStarting(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("library.deleteConfirm", { name: scenario.name }),
      message: t("library.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(scenario.id);
      overlay.toast(t("common.deleted", { name: scenario.name }));
      router.back();
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const edit = (): void => router.push({ pathname: "/scenario/form", params: { id: scenario.id } });

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
        blobId={scenario.cover_blob_id}
        width={coverWidth}
        height={coverHeight}
        rounded={34}
      />
      {/* 封面伸到状态栏下面，返回按钮避开刘海和灵动岛 */}
      <View style={[styles.coverBar, { top: Math.max(insets.top - space.list, 0) + space.s }]}>
        <IconButton
          icon="back"
          label={t("common.back")}
          tone="card"
          diameter={size.touch}
          onPress={() => router.back()}
        />
      </View>
    </View>
  );
  const startHead = (
    <View style={[styles.startHead, expanded ? { paddingTop: insets.top + space.l } : null]}>
      <Text accessibilityRole="header" style={[styles.startTitle, { color: palette.ink }]}>
        {t("start.title")}
      </Text>
      <Text style={[styles.caption, { color: palette.mut }]}>{t("start.hint")}</Text>
    </View>
  );
  const { protagonist, preferences } = scenario.setup;
  const form = (
    <StartForm
      key={scenario.version}
      wide={expanded}
      initial={{ name: protagonist.name, summary: protagonist.summary, ...preferences }}
      onChange={(next, parts) => {
        setValues(next);
        setSummary(parts);
      }}
    />
  );
  const startButton = (
    <Button
      label={t("start.button")}
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
      message={routeMissing ? t("start.noModel") : describeError(startError)}
      actionLabel={routeMissing ? t("start.goSettings") : undefined}
      onAction={routeMissing ? () => router.push("/settings/models") : undefined}
    />
  ) : null;
  const pills = (
    <View
      style={[styles.summary, expanded ? { flex: 1 } : null]}
      accessible
      accessibilityLabel={t("start.willStart", { summary: summary.join(t("common.listSeparator")) })}
    >
      {summary.map((part) => (
        <Pill key={part} label={part} />
      ))}
    </View>
  );
  const danger = (
    <View style={styles.danger}>
      <Button
        label={t("scenario.deleteScenario")}
        variant="danger"
        icon="trash"
        onPress={() => void remove()}
        style={{ alignSelf: "stretch" }}
      />
      <Text style={[styles.caption, { color: palette.mut }]}>{t("library.deleteMessage")}</Text>
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
          <Overview scenario={scenario} onEdit={edit} />
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
        <Overview scenario={scenario} onEdit={edit} />
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
  coverBar: { position: "absolute", left: space.m },
  titleBlock: { paddingTop: 22, paddingHorizontal: space.page, paddingBottom: space.l, gap: space.m },
  caption: { fontSize: 13, lineHeight: 19 },
  hero: { ...type.hero },
  cast: { paddingHorizontal: space.list, gap: 6 },
  castRow: { flexDirection: "row", alignItems: "center", gap: space.m, padding: 8, paddingRight: space.m, borderRadius: radius.option },
  setup: { paddingVertical: 6 },
  setupRow: { paddingVertical: 10, gap: 2 },
  card: {
    marginTop: space.s,
    marginHorizontal: space.list,
    borderRadius: radius.group,
    paddingHorizontal: space.l,
  },
  description: { paddingTop: 18, paddingBottom: space.s },
  expand: { flexDirection: "row", alignItems: "center", gap: 4, height: 44, alignSelf: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  /** 剧本名右边的小按钮 */
  edit: { height: 40, paddingHorizontal: space.l },
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
