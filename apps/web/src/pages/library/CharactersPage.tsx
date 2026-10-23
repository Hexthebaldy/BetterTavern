/**
 * 角色（/characters，docs/design/comic 的 05）：登场人物，一人一张卡，4 × 2，翻页（theme/grid.ts 的 castPage）。
 * - 页头：标题、数量和“登场人物 · 角色卡仓库”；右边是搜索（名字、标签、作者）和“去工作台写一张”；
 * - 每张卡：人物位（有头像用头像，没有就是名字里的一个大字压在网点底上，五种底按卡轮着用）、左下角墨底名牌；
 *   底下是简介的第一行，和题材、世界书条数。指着（或键盘焦点在）一张卡时加蓝色大投影，右下角出现“用这张开局”
 *   （用这张卡新建剧本）。卡本身是指向角色卡详情的链接，右键打开菜单。
 * 设计稿里每张卡右上角的一句台词，接口里没有，先不画。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { CardSummary } from "@bettertavern/core/api/types";

import { Portrait } from "../../components/comic.tsx";
import { Pager, usePager } from "../../components/ComicGrid.tsx";
import { buttonClass, cx, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderSearch, HeaderTool, PageHeader } from "../../components/PageHeader.tsx";
import { newScenarioPath, useCardActions } from "../../data/cardActions.ts";
import { useCards } from "../../data/scenarios.ts";
import { cardPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import { byRecent } from "../../shell/recent.ts";
import { castPage, castPages } from "../../theme/grid.ts";
import pages from "../pages.module.css";
import { matchesCard } from "./collection.ts";
import { LibraryEmpty } from "./LibraryEmpty.tsx";
import styles from "./library.module.css";

export function CharactersPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.characters"));
  const navigate = useNavigate();
  const cards = useCards();
  const actions = useCardActions();
  const [search, setSearch] = useState("");
  const all = useMemo(() => (cards.data ? byRecent(cards.data) : null), [cards.data]);
  const list = (all ?? []).filter((c) => matchesCard(c, search));
  const total = list.length;
  const pageCount = castPages(total);
  const [page, setPage] = usePager(pageCount, `${search}|${total}`);
  const shown = castPage(total, page);

  let body;
  if (!all) {
    body = cards.isPending ? <div className={styles.cast} /> : null;
  } else if (all.length === 0) {
    body = (
      <LibraryEmpty
        title={t("library.emptyCards")}
        note={t("library.emptyCardsNote")}
        actionLabel={t("library.goWorkbench")}
        actionIcon="workbench"
        onAction={() => navigate("/workbench")}
      />
    );
  } else if (total === 0) {
    body = <p className={styles.noMatch}>{t("library.noMatch", { query: search.trim() })}</p>;
  } else {
    body = (
      <>
        <div className={styles.cast} aria-label={t("nav.characters")}>
          {shown.map((index) => {
            const card = list[index];
            return card ? (
              <CastCard
                key={card.id}
                card={card}
                onStart={() => navigate(newScenarioPath(card.id))}
                onMenu={(place) => void actions.menu(card, place)}
              />
            ) : null;
          })}
        </div>
        <Pager page={page} pages={pageCount} onPage={setPage} summary={t("library.castHint")} />
      </>
    );
  }

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.characters")} count={all ? all.length : null} sub={t("library.castSub")}>
        <HeaderSearch
          value={search}
          onChange={setSearch}
          placeholder={t("library.searchCardsShort")}
          label={t("library.searchCards")}
        />
        <button type="button" className={buttonClass("blue", "sm")} onClick={() => navigate("/workbench")}>
          <Icon name="workbench" size={17} strokeWidth={2.2} />
          {t("library.writeOne")}
        </button>
      </PageHeader>
      {cards.error ? (
        <Notice
          icon="offline"
          message={all ? describeError(cards.error) : t("library.loadFailedWith", { error: describeError(cards.error) })}
          actionLabel={all ? t("common.retry") : t("common.reload")}
          onAction={() => void cards.refetch()}
          className={styles.banner}
        />
      ) : null}
      {body}
    </div>
  );
}

function CastCard({
  card,
  onStart,
  onMenu,
}: {
  card: CardSummary;
  onStart: () => void;
  onMenu: Parameters<typeof useContextMenu>[0];
}) {
  const { t } = useTranslation();
  const context = useContextMenu(onMenu);
  const meta = [
    ...card.tags.slice(0, 2),
    card.book_entries ? t("library.loreBook", { count: card.book_entries }) : "",
  ].filter(Boolean);
  return (
    <div className={styles.castCell}>
      <Link to={cardPath(card.id)} className={styles.castCard} {...context}>
        <span className={styles.castPortrait}>
          <Portrait name={card.character_name || card.name} seed={card.id} blobId={card.cover_blob_id} className={styles.fill} />
          <span className={styles.namePlate}>{card.name}</span>
          {card.draft_id ? <Pill tone="acc" label={t("library.draftChip")} className={styles.draftChip} /> : null}
        </span>
        <span className={styles.castFoot}>
          <span className={styles.castIdentity}>{card.description_preview || card.creator || " "}</span>
          <span className={styles.castMeta}>{meta.join(" · ") || " "}</span>
        </span>
      </Link>
      <button type="button" className={cx(buttonClass("primary", "sm"), styles.castStart)} onClick={onStart}>
        <Icon name="play" size={17} strokeWidth={2.2} />
        {t("library.startWithCard")}
      </button>
    </div>
  );
}
