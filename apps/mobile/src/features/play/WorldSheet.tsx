/**
 * 世界状态面板：导演记下的人物与地点、关系图、事实。数据来自 GET /v1/playthroughs/{id}/world。
 * 主角不知道的秘密默认隐藏，揭示前要确认（会剧透）；揭示后标为“秘密 · 已揭示”。三页的内容在 WorldParts.tsx。
 *
 * 形态按阅读页的宽度（theme/layout.ts 的 worldPresentation）：
 * - 手机：从状态栏下方一直到底的底部面板；
 * - 600–1099：从右侧滑出，宽 400，上、下、右各留 8，有遮罩，右上角是 ×；
 * - ≥ 1100：停靠在右侧（WorldDock），不加遮罩，阅读栏在剩下的宽度里居中，右上角是收起按钮（侧栏图标）。
 * 漫画风：几种形态都是页面底色、2.5 墨线；标题“世界”和“截至第 N 回合”，三段切换选中的是墨底。
 * 揭示秘密的确认框在任何形态下都是居中对话框。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeError } from "@bettertavern/core/api/client";
import type { WorldView } from "@bettertavern/core/api/types";
import { worldIssue, worldProgress, worldRefreshDelay } from "@bettertavern/core/play/worldStatus";
import { pane } from "@bettertavern/design/layout";

import { Dots, ErrorState, IconButton, Notice, Segmented, Sheet, useOverlay } from "../../components/ui.tsx";
import { useLayout } from "../../hooks/useLayout.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";
import { Entities, Facts, Links, type Tab } from "./WorldParts.tsx";

/**
 * 取世界状态、揭示秘密。面板开着（active）时：打开时取一次；最新一段变了（headSeq，写完新的一段或回退）再取；
 * 后台还没整理到最新一段时，每隔一会儿再取，整理到了就停（worldRefreshDelay）。
 */
function useWorld(playthroughId: string, active: boolean, headSeq: number | null) {
  const { api } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [view, setView] = useState<WorldView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(
    async (reveal: boolean): Promise<void> => {
      setError(null);
      try {
        setView(await api.playthroughs.world(playthroughId, reveal));
      } catch (e) {
        setError(e);
      }
    },
    [api, playthroughId],
  );

  useEffect(() => {
    if (active) void load(revealed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, load, headSeq]);

  const delay = active ? worldRefreshDelay(view, headSeq) : null;
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => void load(revealed), delay);
    return () => clearTimeout(timer);
    // view 每次取回来都是新对象：取完一次就重新排下一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, view, load]);

  const reveal = async (): Promise<void> => {
    const count = view?.hidden_facts ?? 0;
    const ok = await overlay.confirm({
      title: count > 1 ? t("world.revealMany", { count }) : t("world.revealOne"),
      message: t("world.revealMessage"),
      confirmLabel: t("world.reveal"),
      tone: "warn",
      icon: "lock",
    });
    if (!ok) return;
    setRevealed(true);
    await load(true);
  };

  return { view, error, retry: () => void load(revealed), reveal };
}

type World = ReturnType<typeof useWorld>;

function WorldHeader({
  world,
  tab,
  onTab,
  onClose,
  docked,
}: {
  world: World;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onClose: () => void;
  /** 停靠着：右上角是收起按钮 */
  docked?: boolean;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const { view } = world;
  const counts = view
    ? {
        entities: view.entities.filter((e) => e.kind !== "world").length,
        links: view.links.length,
        facts: view.facts.length + view.hidden_facts,
      }
    : null;
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "entities", label: t("world.tabs.entities"), count: counts?.entities },
    { value: "links", label: t("world.tabs.links"), count: counts?.links },
    { value: "facts", label: t("world.tabs.facts"), count: counts?.facts },
  ];
  return (
    <View>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
            {t("world.title")}
          </Text>
          {view ? (
            <Text style={{ fontSize: 13, lineHeight: 19, color: c.mut }}>{worldProgress(view)}</Text>
          ) : null}
        </View>
        <IconButton
          icon={docked ? "sidebar" : "close"}
          label={docked ? t("play.worldHide") : t("common.close")}
          size={docked ? 20 : 18}
          diameter={38}
          onPress={onClose}
        />
      </View>
      <Segmented
        value={tab}
        options={tabs}
        onChange={onTab}
        style={styles.tabs}
      />
    </View>
  );
}

function WorldBody({ world, tab, panelWidth }: { world: World; tab: Tab; panelWidth: number }) {
  const { view, error } = world;
  const { t } = useTranslation();
  const names = useMemo(() => new Map((view?.entities ?? []).map((e) => [e.id, e.name])), [view]);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      {view && worldIssue(view) ? (
        <Notice tone="warn" message={worldIssue(view)} style={styles.issue} />
      ) : null}
      {view ? (
        tab === "entities" ? (
          <Entities view={view} names={names} />
        ) : tab === "links" ? (
          <Links view={view} names={names} panelWidth={panelWidth} />
        ) : (
          <Facts view={view} names={names} onReveal={() => void world.reveal()} />
        )
      ) : error ? (
        <ErrorState title={t("world.loadFailed")} message={describeError(error)} onRetry={world.retry} />
      ) : (
        <View style={styles.loading}>
          <Dots />
        </View>
      )}
    </ScrollView>
  );
}

/** 手机的底部面板，或平板上从右侧滑出的面板 */
export function WorldSheet({
  visible,
  onClose,
  playthroughId,
  headSeq,
}: {
  visible: boolean;
  onClose: () => void;
  /** 最新一段的序号：变了就重新取 */
  headSeq: number | null;
  playthroughId: string;
}) {
  const c = useComic();
  const { compact, width } = useLayout();
  const world = useWorld(playthroughId, visible, headSeq);
  const [tab, setTab] = useState<Tab>("entities");
  // 手机：面板左右各离屏幕 8；平板：滑出的面板宽 400
  const panelWidth = compact ? width - space.s * 2 : pane.world;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      full
      style={{ backgroundColor: c.page }}
      header={<WorldHeader world={world} tab={tab} onTab={setTab} onClose={onClose} />}
    >
      <WorldBody world={world} tab={tab} panelWidth={panelWidth} />
    </Sheet>
  );
}

/** 停靠在阅读页右侧的世界状态（阅读页宽 ≥ 1100）：宽 400，上、下、右各留 8，2.5 墨线、圆角 16，页面底色，不加遮罩 */
export function WorldDock({
  onClose,
  playthroughId,
  headSeq,
}: {
  onClose: () => void;
  playthroughId: string;
  /** 最新一段的序号：变了就重新取 */
  headSeq: number | null;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const world = useWorld(playthroughId, true, headSeq);
  const [tab, setTab] = useState<Tab>("entities");
  return (
    <View
      accessibilityLabel={t("play.world")}
      style={[
        styles.dock,
        {
          marginTop: insets.top + space.s,
          marginBottom: Math.max(insets.bottom, space.s),
          backgroundColor: c.page,
          borderColor: c.ink,
        },
      ]}
    >
      <WorldHeader world={world} tab={tab} onTab={setTab} onClose={onClose} docked />
      <WorldBody world={world} tab={tab} panelWidth={pane.world - comicStroke.frame * 2} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    paddingLeft: 20,
    paddingRight: space.m,
  },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.5 },
  tabs: { marginTop: 14, marginHorizontal: space.list },
  loading: { padding: space.xxl, alignItems: "center" },
  issue: { marginTop: space.m, marginHorizontal: space.list },
  dock: {
    width: pane.world,
    marginRight: space.s,
    paddingTop: space.s,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.panel,
    overflow: "hidden",
  },
});
