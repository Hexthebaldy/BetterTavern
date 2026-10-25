/**
 * 库（漫画风，docs/design/comic/mobile/png/10–14）：剧本仓库、角色卡仓库、世界书仓库三段，网格或列表显示。
 * 部件在 features/library/LibraryParts.tsx。
 * - 剧本仓库右上角的加号：从角色卡仓库选一张或几张卡新建剧本；网格里长按、列表里左滑或长按可以重命名、删除；
 * - 角色卡仓库右上角：去工作台（新建和导入都在工作台）；长按可以在工作台里改、新建剧本、删除；
 * - 世界书仓库右上角：导入（选 .json）或新建；长按可以改名、删除（docs/lorebook.md 第 9.2 节）。
 * 顶上提示一次“新建和导入挪到了工作台”，关掉以后不再出现。剧本的存档数取自存档列表。
 *
 * 平板（theme/layout.ts）：网格中屏 3 列，宽屏按内容宽度 ÷ 240 取整（最多 5 列），间距 16；列表视图限宽 640、居中。
 * 宽屏（tablet/png/04–05）：侧栏里“剧本”“角色”是两块，所以这里不画三段切换，标题按 tab 写“剧本”或“角色”，
 * “角色”下面画“角色卡 / 世界书”两段切换；挪到工作台的提示只在“角色卡”出现；新建是带文字的主按钮。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { CardSummary, LorebookSummary, Scenario } from "@bettertavern/core/api/types";
import { cellWidth, centerColumn, gap, libraryColumns, tabInsets } from "@bettertavern/design/layout";

import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  ErrorState,
  LargeHeader,
  Loading,
  Notice,
  RefreshPill,
  Segmented,
  useOverlay,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import { useCardActions } from "../../src/features/library/cardActions.ts";
import { useLorebookActions, useLorebookImport, useOpenLorebook } from "../../src/features/library/lorebookActions.ts";
import {
  cardItem,
  Empty,
  HeaderControls,
  LiftedTile,
  lorebookItem,
  Row,
  scenarioItem,
  Tile,
  type Item,
} from "../../src/features/library/LibraryParts.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { space, useComic } from "../../src/theme/index.ts";

type Tab = "scenarios" | "cards" | "lorebooks";

export default function LibraryScreen() {
  const { api } = useApp();
  const router = useRouter();
  const c = useComic();
  const overlay = useOverlay();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = params.tab === "cards" || params.tab === "lorebooks" ? params.tab : "scenarios";
  const { libraryView, setLibraryView, movedHintDismissed, dismissMovedHint } = usePrefs();
  const { t } = useTranslation();
  const { width, size: layoutSize, compact, expanded } = useLayout();
  const nodes = useRef(new Map<string, View>());
  const scenarios = useAsync(() => api.scenarios.list(), [api]);
  const cards = useAsync(() => api.cards.list(), [api]);
  const lorebooks = useAsync(() => api.lorebooks.list(), [api]);
  // 每个剧本开了几个存档（接口里没有这个数，按存档列表数）
  const stories = useAsync(() => api.playthroughs.list().catch(() => []), [api]);
  const cardActions = useCardActions();
  const lorebookActions = useLorebookActions();
  const openLorebook = useOpenLorebook();
  const importer = useLorebookImport((book) => openLorebook(book.id));
  const { bottom: bottomSpace } = useTabBarSpace();

  const setTab = (next: Tab): void => router.setParams({ tab: next === "scenarios" ? undefined : next });
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

  const renameLorebook = async (b: LorebookSummary): Promise<void> => {
    const detail = await lorebookActions.rename(b);
    if (detail) lorebooks.setData((list) => list?.map((x) => (x.id === b.id ? detail.lorebook : x)));
  };

  const removeLorebook = async (b: LorebookSummary): Promise<void> => {
    if (await lorebookActions.remove(b)) {
      lorebooks.setData((list) => list?.filter((x) => x.id !== b.id));
      void scenarios.reload();
    }
  };

  /** 世界书一段右上角：导入或新建 */
  const addLorebook = async (): Promise<void> => {
    const key = await overlay.menu({
      title: t("lorebook.title"),
      items: [
        { key: "import", label: t("lorebook.import"), icon: "import" },
        { key: "create", label: t("lorebook.create"), icon: "plus" },
      ],
    });
    if (key === "import") void importer.pick();
    if (key === "create") void lorebookActions.create();
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
        : tab === "lorebooks"
          ? lorebookActions.menuItems()
          : [
              { key: "rename", label: t("common.rename"), icon: "write" as const },
              { key: "delete", label: t("common.delete"), icon: "trash" as const, danger: true },
            ];
    const key = await overlay.menu({
      title: item.title,
      items,
      anchor: anchor ? { current: anchor } : undefined,
      lifted: anchor && tileWidth ? <LiftedTile item={item} width={tileWidth} /> : undefined,
      liftedRadius: tileWidth ? 12 : undefined,
    });
    if (tab === "cards") {
      const card = cards.data?.find((c) => c.id === item.id);
      if (!card) return;
      if (key === "edit") void cardActions.edit(card);
      if (key === "scenario") cardActions.newScenario(card);
      if (key === "delete") void removeCard(card);
    } else if (tab === "lorebooks") {
      const book = lorebooks.data?.find((b) => b.id === item.id);
      if (!book) return;
      if (key === "rename") void renameLorebook(book);
      if (key === "delete") void removeLorebook(book);
    } else {
      const scenario = scenarios.data?.find((s) => s.id === item.id);
      if (!scenario) return;
      if (key === "rename") void rename(scenario);
      if (key === "delete") void removeScenario(scenario);
    }
  };

  const query = tab === "cards" ? cards : tab === "lorebooks" ? lorebooks : scenarios;
  const savesOf = (id: string): number => (stories.data ?? []).filter((p) => p.scenario_id === id).length;
  const data: Item[] | undefined =
    tab === "cards"
      ? cards.data?.map(cardItem)
      : tab === "lorebooks"
        ? lorebooks.data?.map(lorebookItem)
        : scenarios.data?.map((s) => scenarioItem(s, savesOf(s.id)));
  const open = tab === "cards" ? openCard : tab === "lorebooks" ? openLorebook : openScenario;
  const title = expanded ? (tab === "scenarios" ? t("nav.scenarios") : t("nav.characters")) : t("nav.library");
  const add =
    tab === "cards"
      ? { label: t("library.goWorkbench"), icon: "workbench" as const, onPress: goWorkbench }
      : tab === "lorebooks"
        ? { label: t("lorebook.import"), icon: "import" as const, onPress: () => void addLorebook() }
        : { label: t("library.newScenario"), icon: "plus" as const, onPress: newScenario };
  const header = (
    <>
      <LargeHeader title={title}>
        <HeaderControls
          view={libraryView}
          onView={setLibraryView}
          addLabel={add.label}
          addIcon={add.icon}
          onAdd={add.onPress}
          labelled={expanded}
        />
      </LargeHeader>
      {!expanded ? (
        <Segmented
          hideLabel
          label={t("library.tabs.label")}
          value={tab}
          height={44}
          options={[
            { value: "scenarios", label: t("library.tabs.scenarios"), count: scenarios.data?.length },
            { value: "cards", label: t("lorebook.tabs.cardsShort"), count: cards.data?.length },
            { value: "lorebooks", label: t("lorebook.tabs.lorebooks"), count: lorebooks.data?.length },
          ]}
          onChange={setTab}
          style={styles.tabs}
        />
      ) : tab !== "scenarios" ? (
        <Segmented
          hideLabel
          label={t("lorebook.tabs.label")}
          value={tab}
          height={40}
          options={[
            { value: "cards", label: t("lorebook.tabs.cards"), count: cards.data?.length },
            { value: "lorebooks", label: t("lorebook.tabs.lorebooks"), count: lorebooks.data?.length },
          ]}
          onChange={setTab}
          style={[styles.tabs, styles.subTabs]}
        />
      ) : null}
      {importer.problem ? (
        <Notice
          message={`${importer.problem.title}：${importer.problem.message}`}
          actionLabel={importer.problem.toWorkbench ? t("lorebook.goWorkbench") : undefined}
          onAction={importer.problem.toWorkbench ? goWorkbench : undefined}
          onClose={importer.dismiss}
          style={styles.banner}
        />
      ) : importer.importing ? (
        <Notice tone="info" icon="import" message={t("lorebook.importing", { name: importer.importing })} style={styles.banner} />
      ) : null}
    </>
  );
  // 平板：网格从一级页的留白开始；列表、提示、空状态在居中的内容栏里（≤ 640）
  const sides = tabInsets(layoutSize);
  const column = sides ? centerColumn(width, sides) : null;
  const columnMargins = column ? { marginLeft: column.left, marginRight: column.right } : null;
  // 宽屏的提示只在“角色卡”出现；世界书一段不提示
  const banner =
    !movedHintDismissed && tab !== "lorebooks" && (!expanded || tab === "cards") ? (
      <Notice
        tone="info"
        icon="workbench"
        message={t("library.moved")}
        actionLabel={t("library.movedAction")}
        onAction={goWorkbench}
        onClose={dismissMovedHint}
        link
        style={[styles.banner, columnMargins]}
      />
    ) : null;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
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
      <View style={{ flex: 1, backgroundColor: c.page }}>
        {header}
        {banner}
        <View
          style={column ? { paddingLeft: column.left - 20, paddingRight: column.right - 20 } : null}
        >
          {tab === "lorebooks" ? (
            <Empty
              title={t("lorebook.empty")}
              note={t("lorebook.emptyNote")}
              actionLabel={t("lorebook.import")}
              actionIcon="import"
              onAction={() => void importer.pick()}
            />
          ) : tab === "cards" || noCards ? (
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
  const contentWidth = width - (listInsets ? listInsets.left + listInsets.right : SIDE * 2);
  const columns = grid ? libraryColumns(layoutSize, contentWidth) : 1;
  const spacing = compact ? (grid ? 14 : 12) : gap.library;
  const tileWidth = compact ? (width - SIDE * 2 - spacing) / 2 : cellWidth(contentWidth, columns, spacing);
  const keep = (id: string) => (node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
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
            onRefresh={() => {
              void query.refresh();
              void stories.reload();
            }}
            tintColor={c.ink}
          />
        }
        ListHeaderComponent={query.refreshing ? <RefreshPill /> : null}
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
          if (tab === "lorebooks") {
            const book = lorebooks.data?.find((b) => b.id === item.id);
            if (!book) return row;
            return (
              <SwipeRow
                actions={[
                  { key: "rename", label: t("lorebook.rename"), icon: "write", onPress: () => void renameLorebook(book) },
                  {
                    key: "delete",
                    label: t("common.delete"),
                    icon: "trash",
                    danger: true,
                    onPress: () => void removeLorebook(book),
                  },
                ]}
              >
                {row}
              </SwipeRow>
            );
          }
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

/** 页面左右留边 */
const SIDE = 20;

const styles = StyleSheet.create({
  tabs: { marginHorizontal: SIDE, marginBottom: space.l },
  /** 宽屏“角色”下面的两段切换：不占满一行 */
  subTabs: { alignSelf: "flex-start", minWidth: 280 },
  list: { paddingHorizontal: SIDE, paddingTop: space.xs },
  banner: { marginHorizontal: SIDE, marginBottom: space.l },
});
