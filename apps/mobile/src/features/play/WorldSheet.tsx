/**
 * 世界状态面板：导演记下的人物与地点、关系图、事实。数据来自 GET /v1/playthroughs/{id}/world。
 * 主角不知道的秘密默认隐藏，揭示前要确认（会剧透）；揭示后标为“秘密 · 已揭示”。三页的内容在 WorldParts.tsx。
 *
 * 形态按阅读页的宽度（theme/layout.ts 的 worldPresentation）：
 * - 手机：从状态栏下方一直到底的底部面板；
 * - 600–1099：从右侧滑出，宽 400，上、下、右各留 8，圆角 32，有遮罩，右上角是 ×；
 * - ≥ 1100：停靠在右侧（WorldDock），不加遮罩，阅读栏在剩下的宽度里居中，右上角是收起按钮（侧栏图标）。
 * 平板的两种都是灰底（bg2），里面的卡片是白色（PanelSurfaces）。揭示秘密的确认框在任何形态下都是居中对话框。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeError } from "../../api/client.ts";
import type { WorldView } from "../../api/types.ts";
import {
  Dots,
  ErrorState,
  IconButton,
  PanelSurfaces,
  Segmented,
  Sheet,
  useOverlay,
  useSheetSurfaces,
} from "../../components/ui.tsx";
import { useLayout } from "../../hooks/useLayout.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";
import { pane } from "../../theme/layout.ts";
import { Entities, Facts, Links, type Tab } from "./WorldParts.tsx";

/** 取世界状态、揭示秘密；active 变成 true 时取一次（面板打开、停靠面板展开） */
function useWorld(playthroughId: string, active: boolean) {
  const { api } = useApp();
  const overlay = useOverlay();
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
  }, [active, load]);

  const reveal = async (): Promise<void> => {
    const count = view?.hidden_facts ?? 0;
    const ok = await overlay.confirm({
      title: count > 1 ? `揭示 ${count} 条秘密？` : "揭示一条秘密？",
      message: "这是导演知道、而“我”还不知道的事，看了会剧透接下来的故事。",
      confirmLabel: "揭示",
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
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const { view } = world;
  const counts = view
    ? {
        entities: view.entities.filter((e) => e.kind !== "world").length,
        links: view.links.length,
        facts: view.facts.length + view.hidden_facts,
      }
    : null;
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "entities", label: "人物与地点", count: counts?.entities },
    { value: "links", label: "关系", count: counts?.links },
    { value: "facts", label: "事实", count: counts?.facts },
  ];
  return (
    <View>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
            世界
          </Text>
          <Text style={{ fontSize: 12, lineHeight: 17, color: palette.mut }}>
            导演记下的一切 · 开局时整理
          </Text>
        </View>
        <IconButton
          icon={docked ? "sidebar" : "close"}
          label={docked ? "收起世界状态" : "关闭"}
          size={docked ? 20 : 22}
          onPress={onClose}
          style={{ backgroundColor: surfaces.fill }}
        />
      </View>
      <Segmented
        value={tab}
        options={tabs}
        onChange={onTab}
        trackColor={surfaces.inset}
        selectedColor={surfaces.raised}
        style={styles.tabs}
      />
    </View>
  );
}

function WorldBody({
  world,
  tab,
  panelWidth,
  panel,
}: {
  world: World;
  tab: Tab;
  panelWidth: number;
  panel: boolean;
}) {
  const { view, error } = world;
  const names = useMemo(() => new Map((view?.entities ?? []).map((e) => [e.id, e.name])), [view]);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      {view ? (
        tab === "entities" ? (
          <Entities view={view} names={names} panel={panel} />
        ) : tab === "links" ? (
          <Links view={view} names={names} panelWidth={panelWidth} />
        ) : (
          <Facts view={view} names={names} onReveal={() => void world.reveal()} />
        )
      ) : error ? (
        <ErrorState title="世界状态没加载出来" message={describeError(error)} onRetry={world.retry} />
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
}: {
  visible: boolean;
  onClose: () => void;
  playthroughId: string;
}) {
  const palette = usePalette();
  const { compact, width } = useLayout();
  const world = useWorld(playthroughId, visible);
  const [tab, setTab] = useState<Tab>("entities");
  // 手机：面板左右各离屏幕 8；平板：滑出的面板宽 400
  const panelWidth = compact ? width - space.s * 2 : pane.world;
  const surfaced = (node: ReactNode) => (compact ? node : <PanelSurfaces>{node}</PanelSurfaces>);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      full
      style={compact ? null : { backgroundColor: palette.bg2 }}
      header={surfaced(<WorldHeader world={world} tab={tab} onTab={setTab} onClose={onClose} />)}
    >
      {surfaced(<WorldBody world={world} tab={tab} panelWidth={panelWidth} panel={!compact} />)}
    </Sheet>
  );
}

/** 停靠在阅读页右侧的世界状态（阅读页宽 ≥ 1100）：宽 400，上、下、右各留 8，圆角 32，灰底，不加遮罩 */
export function WorldDock({ onClose, playthroughId }: { onClose: () => void; playthroughId: string }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const world = useWorld(playthroughId, true);
  const [tab, setTab] = useState<Tab>("entities");
  return (
    <View
      accessibilityLabel="世界状态"
      style={[
        styles.dock,
        {
          marginTop: insets.top + space.s,
          marginBottom: Math.max(insets.bottom, space.s),
          backgroundColor: palette.bg2,
        },
      ]}
    >
      <PanelSurfaces>
        <WorldHeader world={world} tab={tab} onTab={setTab} onClose={onClose} docked />
        <WorldBody world={world} tab={tab} panelWidth={pane.world} panel />
      </PanelSurfaces>
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
  title: { fontSize: 24, lineHeight: 32, fontWeight: "700" },
  tabs: { marginTop: 14, marginHorizontal: space.list },
  loading: { padding: space.xxl, alignItems: "center" },
  dock: {
    width: pane.world,
    marginRight: space.s,
    paddingTop: space.s,
    borderRadius: radius.sheet,
    overflow: "hidden",
  },
});
