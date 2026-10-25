/**
 * 剧本详情：封面、剧本里的角色卡（第一张是主角色，点一下看卡）、剧本设置（默认主角、偏好、开场、挂的世界书），
 * 下面是“开始新的故事”的五步表单（按剧本设置预填）。开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 * 剧本名右边是“编辑设置”（form.tsx）；删除剧本的按钮在页面最底下。从编辑页回来时重新加载（useAsync 在回到页面时会再取一次）。
 *
 * 平板（theme/layout.ts）：中屏单栏，宽 640，居中。宽屏两栏（设计稿 T12），两栏各自滚动：
 * 左栏宽 420 是封面（高 236，返回按钮浮在上面）、名字、角色卡、设置、简介；
 * 右栏是开始新故事的五步，底部浮着一条摘要栏（已选项胶囊加“开始故事”）。
 *
 * 漫画风（docs/design/comic/mobile/png/15–17）：手机上封面铺满顶部、底边一道墨线，返回是浮在上面的图标按钮；
 * 平板上封面是墨线的格子。剧本里的卡是一排人物位小卡（主角色是蓝网点底加“主角色”）；设置是墨线格子里的四行；
 * 简介不进框。浮着的摘要栏是白底墨线、墨投影 4。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { currentLanguage, i18n } from "@bettertavern/core/i18n/index";
import { lorebookSummary } from "@bettertavern/core/scenario/lorebook";
import { lengthLabel, splitJoined } from "@bettertavern/core/scenario/startForm";
import { needsModelSettings } from "@bettertavern/core/settings/labels";
import { pane } from "@bettertavern/design/layout";

import { Cover } from "../../../src/components/Cover.tsx";
import { Portrait } from "../../../src/components/Portrait.tsx";
import {
  BackBar,
  Button,
  ErrorState,
  Group,
  IconButton,
  Loading,
  Notice,
  Pill,
  useColumnStyle,
  useOverlay,
} from "../../../src/components/ui.tsx";
import { StartForm, type StartValues } from "../../../src/features/scenario/StartForm.tsx";
import { useAsync } from "../../../src/hooks/useAsync.ts";
import { useLayout } from "../../../src/hooks/useLayout.ts";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { comicDepth, comicRadius, comicStroke, ctype, hardShadow, space, useComic } from "../../../src/theme/index.ts";

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
  const c = useComic();
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
      <Text style={[styles.setupLabel, { color: c.mut }]}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, color: c.ink }}>{value}</Text>
    </View>
  );
  const lead = scenario.cards.length > 1;
  return (
    <>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.hero, { flex: 1, color: c.ink }]}>
          {scenario.name}
        </Text>
        <Button label={t("scenario.editSetup")} icon="write" variant="secondary" small onPress={onEdit} />
      </View>
      <View style={styles.cast}>
        {scenario.cards.map((card, i) => (
          <Pressable
            key={card.card_id}
            accessibilityRole="button"
            accessibilityHint={t("scenario.openCard")}
            onPress={() => router.push({ pathname: "/card/[id]", params: { id: card.card_id } })}
            style={({ pressed }) => [
              styles.castCard,
              { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper },
            ]}
          >
            <Portrait
              name={card.name}
              seed={card.card_id}
              blobId={card.cover_blob_id}
              size={40}
              rounded={7}
              tone={i === 0 && lead ? "blue" : undefined}
            />
            <Text numberOfLines={1} style={[styles.castName, { color: c.ink }]}>
              {card.name}
            </Text>
            {i === 0 && lead ? <Pill label={t("scenario.lead")} tone="accSolid" /> : null}
          </Pressable>
        ))}
      </View>
      <Group style={styles.setup}>
        {setupRow(
          t("scenario.protagonist"),
          protagonist.name
            ? [protagonist.name, protagonist.summary].filter(Boolean).join(" · ")
            : t("scenario.noProtagonist"),
        )}
        {setupRow(t("scenario.preferences"), prefs)}
        {setupRow(t("scenario.opening"), openingText(scenario))}
        {setupRow(t("lorebook.scenarioRow"), lorebookSummary(scenario.lorebooks.map((b) => b.name)))}
      </Group>
      {scenario.description_preview ? (
        <View style={styles.description}>
          <Text accessibilityRole="header" style={[styles.sectionLabel, { color: c.ink }]}>
            {t("scenario.description")}
          </Text>
          <Text
            numberOfLines={expanded ? undefined : 4}
            onTextLayout={(e) => {
              if (!expanded) setClamped(e.nativeEvent.lines.length >= 4);
            }}
            selectable
            style={{ fontSize: 15, lineHeight: 26, color: c.ink2 }}
          >
            {scenario.description_preview}
          </Text>
          {clamped || expanded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded((v) => !v)}
              hitSlop={8}
              style={styles.expand}
            >
              <Text style={{ fontSize: 14.5, fontWeight: "700", color: c.acc }}>
                {expanded ? t("scenario.collapse") : t("scenario.expand")}
              </Text>
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
  const c = useComic();
  const overlay = useOverlay();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width, expanded, compact } = useLayout();
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
      <View style={{ flex: 1, backgroundColor: c.page }}>
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

  const startCode = startError instanceof ApiError ? startError.code : undefined;
  const routeMissing = startCode === "ROUTE_MISSING";
  // 没有导演、官方模型的点数用完了：都带“去设置”按钮
  const toSettings = needsModelSettings(startCode);
  // 封面：手机铺满整宽、伸到状态栏下面；中屏的居中栏最宽 640、宽屏左栏 420，是墨线的格子
  const coverWidth = compact
    ? width
    : (expanded ? pane.scenarioInfo : Math.min(width, column ? pane.readable : width) - space.list * 2) -
      comicStroke.frame * 2;
  const coverHeight = compact ? insets.top + 176 : expanded ? 236 : Math.round(coverWidth * 0.5);

  const cover = (
    <View
      style={[
        compact
          ? [styles.coverBleed, { borderBottomColor: c.ink }]
          : // 平板上封面是框着的格子，放在状态栏下面
            [styles.coverFramed, { marginTop: insets.top + space.s, borderColor: c.ink }],
      ]}
    >
      <Cover seed={scenario.id} blobId={scenario.cover_blob_id} width={coverWidth} height={coverHeight} rounded={0} />
      {/* 返回按钮避开刘海和灵动岛 */}
      <View style={[styles.coverBar, { top: compact ? insets.top + 6 : space.m }]}>
        <IconButton icon="back" label={t("common.back")} diameter={38} onPress={() => router.back()} />
      </View>
    </View>
  );
  const startHead = (
    <View style={[styles.startHead, expanded ? { paddingTop: insets.top + space.l } : null]}>
      <Text accessibilityRole="header" style={[styles.startTitle, { color: c.ink }]}>
        {t("start.title")}
      </Text>
      <Text style={[styles.caption, { color: c.mut }]}>{t("start.hint")}</Text>
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
      actionLabel={toSettings ? t("start.goSettings") : undefined}
      onAction={toSettings ? () => router.push("/settings/models") : undefined}
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
      <Text style={[styles.caption, { color: c.mut, textAlign: "center" }]}>{t("library.deleteMessage")}</Text>
    </View>
  );

  if (expanded) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, flexDirection: "row", backgroundColor: c.page }}
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
                backgroundColor: c.paper,
                borderColor: c.ink,
                boxShadow: hardShadow(c.ink, comicDepth.raised),
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
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <ScrollView
        contentContainerStyle={[{ paddingBottom: insets.bottom + 48 }, column]}
        keyboardShouldPersistTaps="handled"
      >
        {cover}
        <Overview scenario={scenario} onEdit={edit} />
        {startHead}
        {form}
        <View style={styles.submit}>
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
  coverBleed: { borderBottomWidth: comicStroke.frame },
  coverFramed: {
    marginHorizontal: space.list,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  coverBar: { position: "absolute", left: 14 },
  caption: { fontSize: 13, lineHeight: 19 },
  hero: { ...ctype.title, fontSize: 30, lineHeight: 38 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: space.l,
  },
  cast: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 20 },
  castCard: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 7,
    paddingRight: 12,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  castName: { flexShrink: 1, fontSize: 15, fontWeight: "900" },
  setup: { marginTop: space.l, marginHorizontal: 20 },
  setupRow: { flexDirection: "row", gap: space.m, paddingVertical: 14, paddingHorizontal: 14 },
  /** 标签一列：中文四个字正好，英文长的标签换行 */
  setupLabel: { width: "28%", minWidth: 64, fontSize: 13.5, lineHeight: 22, fontWeight: "700" },
  sectionLabel: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  description: { marginTop: 20, paddingHorizontal: 20, gap: space.s },
  expand: { alignSelf: "flex-start", paddingVertical: space.xs },
  startHead: {
    paddingTop: 36,
    paddingBottom: space.l,
    paddingHorizontal: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 10,
    rowGap: space.xs,
  },
  startTitle: { ...ctype.title, fontSize: 26, lineHeight: 32 },
  submit: { marginTop: space.s, marginHorizontal: 20, gap: space.m },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  startButton: { alignSelf: "stretch" },
  /** 宽屏右栏底部浮着的摘要栏 */
  floatingBar: {
    position: "absolute",
    left: space.l,
    right: space.l,
    marginTop: 0,
    marginHorizontal: 0,
    padding: space.s,
    paddingLeft: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: 32,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  danger: { marginTop: 40, marginHorizontal: 20, gap: space.s, alignItems: "center" },
});
