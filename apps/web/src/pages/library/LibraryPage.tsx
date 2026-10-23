/**
 * “剧本”（/scenarios）和“角色”（/characters）两个一级页，共用一套框架（CollectionPage）：
 * - 页头：标题和数量；右边一行工具条：搜索、排序、网格/表格切换、主按钮
 *   （剧本是“新建剧本”，从角色卡里选一张或几张；角色是“去工作台”，新建和导入都在工作台）；
 * - 网格：按内容宽度 ÷ 240 取整（2–5 列），间距 16；
 * - 表格：一行一个，列出更多信息（剧本：用了哪些角色卡、简介、修改时间；角色：来源、世界书、几个剧本在用、修改时间）。
 * 卡片和行都是指向详情的链接；悬停出现“…”，右键打开同一个菜单。
 * 旧地址 /library（?tab=cards 是角色卡）跳到这两页（LibraryRedirect）。
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import { cellWidth, libraryColumns, sizeClass } from "@bettertavern/design/layout";

import { Button, Notice } from "../../components/controls.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { newScenarioPath, useCardActions } from "../../data/cardActions.ts";
import { scenarioPath, useScenarioActions } from "../../data/scenarioActions.ts";
import { useCards, useScenarios } from "../../data/scenarios.ts";
import { cardPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useElementWidth } from "../../hooks/useElementWidth.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { desktop } from "../../theme/layout.ts";
import pages from "../pages.module.css";
import {
  cardItem,
  Empty,
  matches,
  scenarioItem,
  sortItems,
  Tile,
  Toolbar,
  ItemTable,
  type Item,
  type Kind,
  type SortKey,
} from "./LibraryParts.tsx";
import styles from "./library.module.css";

const GAP = 16;

export function ScenariosPage() {
  return <CollectionPage kind="scenarios" />;
}

export function CharactersPage() {
  return <CollectionPage kind="cards" />;
}

/** 旧地址 /library 和 /library?tab=cards */
export function LibraryRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={params.get("tab") === "cards" ? "/characters" : "/scenarios"} replace />;
}

function CollectionPage({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const title = kind === "cards" ? t("nav.characters") : t("nav.scenarios");
  useDocumentTitle(title);
  const navigate = useNavigate();
  const scenarios = useScenarios();
  const cards = useCards();
  const scenarioActions = useScenarioActions();
  const cardActions = useCardActions();
  const { libraryView, setLibraryView, movedHintDismissed, dismissMovedHint } = usePrefs();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const windowWidth = useWindowWidth();
  const box = useRef<HTMLDivElement>(null);
  const contentWidth = useElementWidth(box);
  const columns = libraryColumns(sizeClass(windowWidth), contentWidth);
  const tileWidth = contentWidth > 0 ? cellWidth(contentWidth, columns, GAP) : 0;
  const grid = libraryView === "grid";

  const query = kind === "cards" ? cards : scenarios;
  const all: Item[] | undefined = useMemo(
    () =>
      kind === "cards"
        ? cards.data?.map((c) => ({
            ...cardItem(c, cardPath(c.id)),
            menu: (place) => void cardActions.menu(c, place),
          }))
        : scenarios.data?.map((s) => ({
            ...scenarioItem(s, scenarioPath(s)),
            menu: (place) => void scenarioActions.menu(s, place),
          })),
    [kind, cards.data, scenarios.data, cardActions, scenarioActions],
  );
  const items = all ? sortItems(all.filter((item) => matches(item, search)), sort) : undefined;
  const hasCards = (cards.data?.length ?? 0) > 0;

  const add =
    kind === "cards"
      ? { label: t("library.goWorkbench"), icon: "workbench" as const, run: () => navigate("/workbench") }
      : { label: t("library.newScenario"), icon: "plus" as const, run: () => navigate(newScenarioPath()) };

  let body;
  if (!all || !items) {
    body = query.isPending ? (
      <div className={styles.loading}>
        <Button label={t("common.loading")} variant="text" busy />
      </div>
    ) : null;
  } else if (all.length === 0) {
    body =
      kind === "cards" || !hasCards ? (
        <Empty
          title={kind === "cards" ? t("library.emptyCards") : t("library.emptyScenarios")}
          note={kind === "cards" ? t("library.emptyCardsNote") : t("library.emptyScenariosNote")}
          actionLabel={t("library.goWorkbench")}
          actionIcon="workbench"
          onAction={() => navigate("/workbench")}
        />
      ) : (
        <Empty
          title={t("library.emptyScenarios")}
          note={t("library.emptyScenariosNote")}
          actionLabel={t("library.newScenario")}
          actionIcon="plus"
          onAction={() => navigate(newScenarioPath())}
        />
      );
  } else if (items.length === 0) {
    body = <p className={styles.noMatch}>{t("library.noMatch", { query: search.trim() })}</p>;
  } else if (grid) {
    body = (
      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <Tile key={item.id} item={item} width={tileWidth} onMenu={item.menu} />
        ))}
      </div>
    );
  } else {
    body = <ItemTable kind={kind} items={items} />;
  }

  return (
    <div className={pages.page}>
      <PageHeader title={title} count={all?.length ?? null}>
        <Toolbar
          kind={kind}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          view={libraryView}
          onView={setLibraryView}
          addLabel={add.label}
          addIcon={add.icon}
          onAdd={add.run}
          labelled={windowWidth >= desktop.rail}
        />
      </PageHeader>
      {kind === "cards" && !movedHintDismissed ? (
        <Notice
          tone="info"
          message={t("library.moved")}
          actionLabel={t("library.movedAction")}
          onAction={() => navigate("/workbench")}
          onClose={dismissMovedHint}
          className={styles.banner}
        />
      ) : null}
      {query.error ? (
        <Notice
          icon="offline"
          message={all ? describeError(query.error) : t("library.loadFailedWith", { error: describeError(query.error) })}
          actionLabel={all ? t("common.retry") : t("common.reload")}
          onAction={() => void query.refetch()}
          className={styles.banner}
        />
      ) : null}
      <div ref={box}>{body}</div>
    </div>
  );
}
