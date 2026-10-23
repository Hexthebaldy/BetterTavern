/**
 * 存档（docs/design/comic 的 01）：漫画格子，一页排满，翻页（theme/grid.ts 的 savesPage）。
 * 第一页最近玩的那个占左上的大格：剧本名、最近一段的摘录（旁白框）、“继续”、回合数，右边是主角色的人物位；
 * 正在生成的存档是墨底格，写“● 正在写”；“新的故事 ＋”是一格蓝网点（键 N，去剧本页挑一个）。其他存档是白格。
 * 每一格就是指向阅读页的链接；右键和悬停出现的“…”打开同一个菜单（在新标签页打开、重命名、删除）。
 * 没有下拉刷新：回到标签页时自动刷新。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { buttonClass, Notice } from "../../components/controls.tsx";
import { ComicGrid, Pager, slotStyle, usePager } from "../../components/ComicGrid.tsx";
import { Panel } from "../../components/comic.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useScenarios } from "../../data/scenarios.ts";
import { useStories } from "../../data/stories.ts";
import { useStoryActions } from "../../data/storyActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { byRecent } from "../../shell/recent.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { acceptsSingleKey } from "../../theme/layout.ts";
import { savesPage, savesPages } from "../../theme/grid.ts";
import pages from "../pages.module.css";
import { NewStoryCell, SaveCell, type MainCast } from "./StoryCells.tsx";
import styles from "./stories.module.css";

function Skeleton() {
  return (
    <ComicGrid>
      {savesPage(6, 0).map((cell, i) => (
        <Panel key={i} tone="grey" className={styles.skeleton} style={slotStyle(cell.slot)} />
      ))}
    </ComicGrid>
  );
}

function Empty() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <ComicGrid>
      <Panel tone="dots" hot className={styles.empty} style={{ gridColumn: "1 / span 4", gridRow: "1 / span 3" }}>
        <h2 className={styles.emptyTitle}>{t("stories.emptyTitle")}</h2>
        <p className={styles.emptyText}>{t("stories.emptyText")}</p>
        <button type="button" className={buttonClass("primary")} onClick={() => navigate("/scenarios")}>
          <Icon name="play" size={19} strokeWidth={2.2} />
          {t("stories.pickScenario")}
        </button>
      </Panel>
      <NewStoryCell slot={{ col: 5, row: 1, w: 2, h: 3 }} />
    </ComicGrid>
  );
}

export function StoriesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.saves"));
  const navigate = useNavigate();
  const stories = useStories();
  const scenarios = useScenarios();
  const actions = useStoryActions();
  const { singleKeys } = usePrefs();
  const list = stories.data ? byRecent(stories.data) : null;
  const total = list?.length ?? 0;
  const pageCount = savesPages(total);
  const [page, setPage] = usePager(pageCount, String(total));
  const failure = stories.error
    ? stories.error instanceof ApiError && stories.error.isNetwork
      ? t("stories.offlineShort")
      : describeError(stories.error)
    : null;

  // 主角色：剧本的第一张卡（名字、头像）
  const castOf = (scenarioId: string | null): MainCast | null => {
    const scenario = scenarios.data?.find((s) => s.id === scenarioId);
    const card = scenario?.cards[0];
    return card ? { id: card.card_id, name: card.name, blobId: card.cover_blob_id } : null;
  };

  // N：新的故事（去剧本页挑一个）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const single = acceptsSingleKey({
        enabled: singleKeys,
        typing,
        composing: event.isComposing,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      });
      if (single && event.key.toLowerCase() === "n") {
        event.preventDefault();
        navigate("/scenarios");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [singleKeys, navigate]);

  const cells = list ? savesPage(total, page) : [];
  const shown = cells.filter((c) => c.item !== null).length;

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.saves")} count={list ? total : null} />
      {failure ? (
        <Notice
          icon="offline"
          message={failure}
          actionLabel={list ? t("common.retry") : t("common.reload")}
          onAction={() => void stories.refetch()}
          className={styles.notice}
        />
      ) : null}
      {!list ? (
        stories.isPending ? (
          <Skeleton />
        ) : null
      ) : total === 0 ? (
        <Empty />
      ) : (
        <>
          <ComicGrid label={t("nav.saves")}>
            {cells.map((cell) => {
              if (cell.item === null) return <NewStoryCell key="new" slot={cell.slot} />;
              const story = list[cell.item];
              if (!story) return null;
              return (
                <SaveCell
                  key={story.id}
                  story={story}
                  number={cell.item + 1}
                  kind={cell.kind}
                  slot={cell.slot}
                  cast={castOf(story.scenario_id)}
                  onMenu={actions.menu}
                />
              );
            })}
          </ComicGrid>
          <Pager
            page={page}
            pages={pageCount}
            onPage={setPage}
            summary={t("stories.pageSummary", { count: total, n: shown })}
          />
        </>
      )}
    </div>
  );
}
