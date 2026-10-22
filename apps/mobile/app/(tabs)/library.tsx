/**
 * “剧本”页（同网页端 pages/library/LibraryPage.tsx）：剧本仓库和角色卡仓库两个标签，网格或列表显示。
 * - 剧本仓库右上角的加号：从角色卡仓库选一张或几张卡新建剧本；网格里长按、列表里左滑或长按可以重命名、删除；
 * - 角色卡仓库右上角：去工作台（新建和导入都在工作台）；长按可以在工作台里改、新建剧本、删除。
 * 顶上提示一次“新建和导入挪到了工作台”，关掉以后不再出现。
 *
 * 平板（theme/layout.ts）：网格中屏 3 列，宽屏按内容宽度 ÷ 240 取整（最多 5 列），间距 16；列表视图限宽 640、居中。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { cellWidth, centerColumn, gap, libraryColumns, tabInsets } from "@bettertavern/design/layout";

import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  ErrorState,
  LargeHeader,
  Loading,
  Notice,
  Segmented,
  useOverlay,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import { useCardActions } from "../../src/features/library/cardActions.ts";
import {
  cardItem,
  Empty,
  HeaderControls,
  LiftedTile,
  Row,
  scenarioItem,
  Tile,
  type Item,
} from "../../src/features/library/LibraryParts.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { radius, space, usePalette } from "../../src/theme/index.ts";

type Tab = "scenarios" | "cards";

export default function LibraryScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = params.tab === "cards" ? "cards" : "scenarios";
  const { libraryView, setLibraryView, movedHintDismissed, dismissMovedHint } = usePrefs();
  const { t } = useTranslation();
  const { width, size: layoutSize, compact, expanded } = useLayout();
  const nodes = useRef(new Map<string, View>());
  const scenarios = useAsync(() => api.scenarios.list(), [api]);
  const cards = useAsync(() => api.cards.list(), [api]);
  const cardActions = useCardActions();
  const { bottom: bottomSpace } = useTabBarSpace();

  const setTab = (next: Tab): void => router.setParams({ tab: next === "cards" ? "cards" : undefined });
  const openScenario = (id: string): void => router.push({ pathname: "/scenario/[id]", params: { id } });
  const openCard = (id: string): void => router.push({ pathname: "/card/[id]", params: { id } });
  const newScenario = (): void => router.push({ pathname: "/scenario/form" });
  const goWorkbench = (): void => router.navigate("/workbench");

  const rename = async (s: Scenario): Promise<void> => {
    const name = await overlay.prompt({
      title: t("library.renameTitle"),
      label: t("library.nameLabel"),
      initial: s.name,
      maxLength: 80,
    });
    if (!name || name === s.name) return;
    try {
      const updated = await api.scenarios.update(s.id, { name });
      scenarios.setData((list) => list?.map((x) => (x.id === s.id ? updated : x)));
    } catch (e) {
      overlay.toast(t("common.renameFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const removeScenario = async (s: Scenario): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("library.deleteConfirm", { name: s.name }),
      message: t("library.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(s.id);
      scenarios.setData((list) => list?.filter((x) => x.id !== s.id));
      void cards.reload();
      overlay.toast(t("common.deleted", { name: s.name }));
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const removeCard = async (c: CardSummary): Promise<void> => {
    if (await cardActions.remove(c)) cards.setData((list) => list?.filter((x) => x.id !== c.id));
  };

  /** tileWidth 只在平板的网格里传：菜单贴着这张卡片弹出，卡片抬起 */
  const menu = async (item: Item, tileWidth?: number): Promise<void> => {
    const anchor = compact ? null : (nodes.current.get(item.id) ?? null);
    const items =
      tab === "cards"
        ? [
            { key: "edit", label: t("cards.openInWorkbench"), icon: "workbench" as const },
            { key: "scenario", label: t("cards.newScenario"), icon: "plus" as const },
            { key: "delete", label: t("common.delete"), icon: "trash" as const, danger: true },
          ]
        : [
            { key: "rename", label: t("common.rename"), icon: "write" as const },
            { key: "delete", label: t("common.delete"), icon: "trash" as const, danger: true },
          ];
    const key = await overlay.menu({
      title: item.title,
      items,
      anchor: anchor ? { current: anchor } : undefined,
      lifted: anchor && tileWidth ? <LiftedTile item={item} width={tileWidth} /> : undefined,
      liftedRadius: tileWidth ? 26 : undefined,
    });
    if (tab === "cards") {
      const card = cards.data?.find((c) => c.id === item.id);
      if (!card) return;
      if (key === "edit") void cardActions.edit(card);
      if (key === "scenario") cardActions.newScenario(card);
      if (key === "delete") void removeCard(card);
    } else {
      const scenario = scenarios.data?.find((s) => s.id === item.id);
      if (!scenario) return;
      if (key === "rename") void rename(scenario);
      if (key === "delete") void removeScenario(scenario);
    }
  };

  const query = tab === "cards" ? cards : scenarios;
  const data: Item[] | undefined =
    tab === "cards" ? cards.data?.map(cardItem) : scenarios.data?.map(scenarioItem);
  const open = tab === "cards" ? openCard : openScenario;
  const header = (
    <>
      <LargeHeader title={t("nav.library")}>
        <HeaderControls
          view={libraryView}
          onView={setLibraryView}
          addLabel={tab === "cards" ? t("library.goWorkbench") : t("library.newScenario")}
          addIcon={tab === "cards" ? "workbench" : "plus"}
          onAdd={tab === "cards" ? goWorkbench : newScenario}
          labelled={expanded}
        />
      </LargeHeader>
      <Segmented
        hideLabel
        label={t("library.tabs.label")}
        value={tab}
        height={40}
        options={[
          { value: "scenarios", label: t("library.tabs.scenarios"), count: scenarios.data?.length },
          { value: "cards", label: t("library.tabs.cards"), count: cards.data?.length },
        ]}
        onChange={setTab}
        style={styles.tabs}
      />
    </>
  );
  // 平板：网格从一级页的留白开始；列表、提示、空状态在居中的内容栏里（≤ 640）
  const sides = tabInsets(layoutSize);
  const column = sides ? centerColumn(width, sides) : null;
  const columnMargins = column ? { marginLeft: column.left, marginRight: column.right } : null;
  const banner = !movedHintDismissed ? (
    <Notice
      tone="info"
      message={t("library.moved")}
      actionLabel={t("library.movedAction")}
      onAction={goWorkbench}
      onClose={dismissMovedHint}
      style={[styles.banner, columnMargins]}
    />
  ) : null;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        {query.loading ? (
          <Loading />
        ) : (
          <ErrorState
            title={t("library.loadFailed")}
            message={describeError(query.error)}
            onRetry={() => void query.reload()}
            style={{ marginTop: space.l }}
          />
        )}
      </View>
    );
  }
  if (data.length === 0) {
    const noCards = (cards.data?.length ?? 0) === 0;
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        {banner}
        <View
          style={column ? { paddingLeft: column.left - space.l, paddingRight: column.right - space.l } : null}
        >
          {tab === "cards" || noCards ? (
            <Empty
              title={tab === "cards" ? t("library.emptyCards") : t("library.emptyScenarios")}
              note={tab === "cards" ? t("library.emptyCardsNote") : t("library.emptyScenariosNote")}
              actionLabel={t("library.goWorkbench")}
              actionIcon="workbench"
              onAction={goWorkbench}
            />
          ) : (
            <Empty
              title={t("library.emptyScenarios")}
              note={t("library.emptyScenariosNote")}
              actionLabel={t("library.newScenario")}
              actionIcon="plus"
              onAction={newScenario}
            />
          )}
        </View>
      </View>
    );
  }

  const grid = libraryView === "grid";
  const listInsets = sides ? (grid ? sides : column) : null;
  const contentWidth = width - (listInsets ? listInsets.left + listInsets.right : space.list * 2);
  const columns = grid ? libraryColumns(layoutSize, contentWidth) : 1;
  const spacing = compact ? space.s : gap.library;
  const tileWidth = compact
    ? (width - space.list * 2 - space.s) / 2
    : cellWidth(contentWidth, columns, spacing);
  const keep = (id: string) => (node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      {banner}
      {query.error ? (
        <Notice
          icon="offline"
          message={describeError(query.error)}
          actionLabel={t("common.retry")}
          onAction={() => void query.reload()}
          style={[styles.banner, columnMargins]}
        />
      ) : null}
      <FlatList
        // 列数、标签变了要换一个列表：FlatList 不能在原地改 numColumns
        key={`${tab}-${libraryView}-${columns}`}
        data={data}
        numColumns={columns}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomSpace },
          listInsets ? { paddingLeft: listInsets.left, paddingRight: listInsets.right } : null,
        ]}
        columnWrapperStyle={grid ? { gap: spacing } : undefined}
        ItemSeparatorComponent={() => <View style={{ height: spacing }} />}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing}
            onRefresh={() => void query.refresh()}
            tintColor={palette.mut}
          />
        }
        renderItem={({ item }) => {
          if (grid) {
            return (
              <Tile
                ref={keep(item.id)}
                item={item}
                width={tileWidth}
                onPress={() => open(item.id)}
                onLongPress={() => void menu(item, tileWidth)}
              />
            );
          }
          const row = (
            <Row ref={keep(item.id)} item={item} onPress={() => open(item.id)} onLongPress={() => void menu(item)} />
          );
          // 宽屏只用长按；角色卡没有左滑（删除前要先看在用的剧本）
          if (expanded || tab === "cards") return row;
          const scenario = scenarios.data?.find((s) => s.id === item.id);
          if (!scenario) return row;
          return (
            <SwipeRow
              actions={[
                { key: "rename", label: t("common.rename"), icon: "write", onPress: () => void rename(scenario) },
                {
                  key: "delete",
                  label: t("common.delete"),
                  icon: "trash",
                  danger: true,
                  onPress: () => void removeScenario(scenario),
                },
              ]}
            >
              {row}
            </SwipeRow>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { marginHorizontal: space.page, marginBottom: space.m },
  list: { paddingHorizontal: space.list, paddingTop: space.s },
  banner: { marginHorizontal: space.list, marginBottom: space.s, borderRadius: radius.option },
});
