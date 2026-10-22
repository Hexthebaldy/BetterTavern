/**
 * “剧本”页（W04）：剧本仓库和角色卡仓库两个标签（地址 ?tab=cards 是角色卡），网格或列表显示。
 * 网格按内容宽度 ÷ 240 取整（2–5 列，平板中屏 3 列、手机 2 列），间距 16；列表限宽 640、居中。
 * - 剧本仓库右上角的加号：从角色卡仓库选一张或几张卡新建剧本；
 * - 角色卡仓库右上角：去工作台（新建和导入都在工作台）。
 * 顶上提示一次“新建和导入挪到了工作台”，关掉以后不再出现。
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

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
import { cardItem, Empty, HeaderControls, Row, scenarioItem, Tabs, Tile, type Item, type LibraryTab } from "./LibraryParts.tsx";
import styles from "./library.module.css";

const GAP = 16;

export function LibraryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.library"));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: LibraryTab = params.get("tab") === "cards" ? "cards" : "scenarios";
  const scenarios = useScenarios();
  const cards = useCards();
  const scenarioActions = useScenarioActions();
  const cardActions = useCardActions();
  const { libraryView, setLibraryView, movedHintDismissed, dismissMovedHint } = usePrefs();
  const windowWidth = useWindowWidth();
  const box = useRef<HTMLDivElement>(null);
  const contentWidth = useElementWidth(box);
  const size = sizeClass(windowWidth);
  const columns = libraryColumns(size, contentWidth);
  const tileWidth = contentWidth > 0 ? cellWidth(contentWidth, columns, GAP) : 0;
  const grid = libraryView === "grid";

  const query = tab === "cards" ? cards : scenarios;
  const items: (Item & { menu: (place: Parameters<typeof scenarioActions.menu>[1]) => void })[] | undefined =
    tab === "cards"
      ? cards.data?.map((c) => ({ ...cardItem(c, cardPath(c.id)), menu: (place) => void cardActions.menu(c, place) }))
      : scenarios.data?.map((s) => ({
          ...scenarioItem(s, scenarioPath(s)),
          menu: (place) => void scenarioActions.menu(s, place),
        }));
  const empty = items !== undefined && items.length === 0;
  const hasCards = (cards.data?.length ?? 0) > 0;

  const setTab = (next: LibraryTab): void => {
    setParams(next === "cards" ? { tab: "cards" } : {}, { replace: true });
  };

  const add =
    tab === "cards"
      ? { label: t("library.goWorkbench"), icon: "workbench" as const, run: () => navigate("/workbench") }
      : { label: t("library.newScenario"), icon: "plus" as const, run: () => navigate(newScenarioPath()) };

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.library")} count={null}>
        <HeaderControls
          view={libraryView}
          onView={setLibraryView}
          addLabel={add.label}
          addIcon={add.icon}
          onAdd={add.run}
          labelled={windowWidth >= desktop.rail}
        />
      </PageHeader>
      <Tabs
        tab={tab}
        onTab={setTab}
        counts={{ scenarios: scenarios.data?.length ?? null, cards: cards.data?.length ?? null }}
      />
      {!movedHintDismissed ? (
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
          message={
            items ? describeError(query.error) : t("library.loadFailedWith", { error: describeError(query.error) })
          }
          actionLabel={items ? t("common.retry") : t("common.reload")}
          onAction={() => void query.refetch()}
          className={styles.banner}
        />
      ) : null}
      <div ref={box}>
        {!items ? (
          query.isPending ? (
            <div className={styles.loading}>
              <Button label={t("common.loading")} variant="text" busy />
            </div>
          ) : null
        ) : empty ? (
          tab === "cards" || !hasCards ? (
            <Empty
              title={tab === "cards" ? t("library.emptyCards") : t("library.emptyScenarios")}
              note={tab === "cards" ? t("library.emptyCardsNote") : t("library.emptyScenariosNote")}
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
          )
        ) : grid ? (
          <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {items.map((item) => (
              <Tile key={item.id} item={item} width={tileWidth} onMenu={item.menu} />
            ))}
          </div>
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <Row key={item.id} item={item} onMenu={item.menu} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
