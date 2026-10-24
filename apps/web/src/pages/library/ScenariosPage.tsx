/**
 * 剧本（/scenarios，docs/design/comic 的 04）：漫画格子，一页排满，翻页（theme/grid.ts 的 scenariosPage）。
 * - 页头：标题和数量；右边是搜索（名字、角色卡、题材）、题材筛选、导入（导入角色卡，进工作台）；
 * - 第一页最近添加的剧本占左边一整列：大封面、题材和卡数存档数、剧本名、简介、主角色、默认主角，“开局”和“看设定”；
 *   按 Enter 也是开局。设置里有默认主角时直接开一局进阅读页，没有就去剧本详情填；
 * - 其余的剧本是宽格（封面在左）和窄格（封面在上）；“新建剧本 ＋”是蓝网点格。
 * 格子是指向剧本详情的链接；右键打开菜单（在新标签页打开、重命名、删除）。
 * 题材取剧本里几张卡的标签（剧本本身没有题材字段）。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Caption, Keycap, Panel, panelClass, Portrait } from "../../components/comic.tsx";
import { ComicGrid, Pager, slotStyle, usePager } from "../../components/ComicGrid.tsx";
import { Button, cx, Notice, Pill } from "../../components/controls.tsx";
import { FluidCover } from "../../components/FluidCover.tsx";
import { HeaderSearch, HeaderSelect, HeaderTool, PageHeader } from "../../components/PageHeader.tsx";
import { newScenarioPath } from "../../data/cardActions.ts";
import { scenarioPath, useScenarioActions } from "../../data/scenarioActions.ts";
import { useCards, useScenarios } from "../../data/scenarios.ts";
import { storiesKey, useStories } from "../../data/stories.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useImporter } from "../../import/ImportProvider.tsx";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { scenariosPage, scenariosPages, type ScenarioCell, type Slot } from "../../theme/grid.ts";
import pages from "../pages.module.css";
import { byCreated, genreOptions, matchesScenario, scenarioTags } from "./collection.ts";
import { LibraryEmpty } from "./LibraryEmpty.tsx";
import styles from "./library.module.css";

type Entry = { scenario: Scenario; tags: string[]; saves: number };

export function ScenariosPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.scenarios"));
  const navigate = useNavigate();
  const scenarios = useScenarios();
  const cards = useCards();
  const stories = useStories();
  const actions = useScenarioActions();
  const importer = useImporter();
  const start = useQuickStart();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("");

  const cardMap = useMemo(() => new Map((cards.data ?? []).map((c) => [c.id, c])), [cards.data]);
  const all: Entry[] | null = useMemo(() => {
    if (!scenarios.data) return null;
    return byCreated(scenarios.data).map((scenario) => ({
      scenario,
      tags: scenarioTags(scenario, cardMap),
      saves: (stories.data ?? []).filter((s) => s.scenario_id === scenario.id).length,
    }));
  }, [scenarios.data, cardMap, stories.data]);
  const genres = useMemo(() => genreOptions((all ?? []).map((e) => e.tags)), [all]);
  const list = (all ?? []).filter(
    (e) => matchesScenario(e.scenario, e.tags, search) && (!genre || e.tags.includes(genre)),
  );
  const total = list.length;
  const pageCount = scenariosPages(total);
  const [page, setPage] = usePager(pageCount, `${search}|${genre}|${total}`);
  const cells = scenariosPage(total, page);
  const shown = cells.filter((c) => c.item !== null).length;
  const hero = page === 0 ? list[0] : undefined;

  // Enter：用最近添加的那个剧本开局（焦点不在别的东西上时）
  useEffect(() => {
    if (!hero) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void start.run(hero.scenario);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hero, start]);

  let body;
  if (!all) {
    body = scenarios.isPending ? <ComicGrid>{null}</ComicGrid> : null;
  } else if (all.length === 0) {
    const hasCards = (cards.data?.length ?? 0) > 0;
    body = (
      <LibraryEmpty
        title={t("library.emptyScenarios")}
        note={t("library.emptyScenariosNote")}
        actionLabel={hasCards ? t("library.newScenario") : t("library.goWorkbench")}
        actionIcon={hasCards ? "plus" : "workbench"}
        onAction={() => navigate(hasCards ? newScenarioPath() : "/workbench")}
      />
    );
  } else if (total === 0) {
    body = <p className={styles.noMatch}>{t("library.noMatch", { query: search.trim() || genre })}</p>;
  } else {
    body = (
      <>
        <ComicGrid label={t("nav.scenarios")}>
          {cells.map((cell) => {
            if (cell.item === null) return <NewScenarioCell key="new" slot={cell.slot} />;
            const entry = list[cell.item];
            if (!entry) return null;
            if (cell.kind === "hero")
              return (
                <ScenarioHero
                  key={entry.scenario.id}
                  entry={entry}
                  slot={cell.slot}
                  cards={cardMap}
                  starting={start.busy === entry.scenario.id}
                  onStart={() => void start.run(entry.scenario)}
                  onMenu={(place) => void actions.menu(entry.scenario, place)}
                />
              );
            return (
              <ScenarioTile
                key={entry.scenario.id}
                entry={entry}
                kind={cell.kind}
                slot={cell.slot}
                onMenu={(place) => void actions.menu(entry.scenario, place)}
              />
            );
          })}
        </ComicGrid>
        <Pager
          page={page}
          pages={pageCount}
          onPage={setPage}
          summary={t("library.scenarioPageSummary", { count: total, n: shown })}
        />
      </>
    );
  }

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.scenarios")} count={all ? all.length : null}>
        <HeaderSearch
          value={search}
          onChange={setSearch}
          placeholder={t("library.searchScenariosShort")}
          label={t("library.searchScenarios")}
        />
        {genres.length > 0 ? (
          <HeaderSelect
            aria-label={t("library.genre")}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          >
            <option value="">{t("library.allGenres")}</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </HeaderSelect>
        ) : null}
        <HeaderTool
          icon="import"
          label={t("library.import")}
          onClick={importer.pick}
          disabled={importer.progress !== null}
        />
      </PageHeader>
      {importer.problem ? (
        <Notice
          message={
            <>
              <strong>{importer.problem.title}</strong> {importer.problem.message}
            </>
          }
          onClose={importer.dismissProblem}
          className={styles.banner}
        />
      ) : null}
      {start.error ? <Notice message={start.error} onClose={start.clear} className={styles.banner} /> : null}
      {scenarios.error ? (
        <Notice
          icon="offline"
          message={
            all
              ? describeError(scenarios.error)
              : t("library.loadFailedWith", { error: describeError(scenarios.error) })
          }
          actionLabel={all ? t("common.retry") : t("common.reload")}
          onAction={() => void scenarios.refetch()}
          className={styles.banner}
        />
      ) : null}
      {body}
    </div>
  );
}

/**
 * 开局：剧本设置里有默认主角时直接开一局进阅读页（提示词用当前的界面语言），没有就去剧本详情填开局表单。
 * 没有导演模型、点数用完这类错误显示在页头下面。
 */
function useQuickStart() {
  const { api } = useApp();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (scenario: Scenario): Promise<void> => {
    if (busy) return;
    if (!scenario.setup.protagonist.name.trim()) {
      navigate(scenarioPath(scenario));
      return;
    }
    setBusy(scenario.id);
    setError(null);
    try {
      const created = await api.playthroughs.create({ scenario_id: scenario.id, language: currentLanguage() });
      void queries.invalidateQueries({ queryKey: storiesKey });
      navigate(`/play/${encodeURIComponent(created.playthrough.id)}`);
    } catch (e) {
      setError(describeError(e));
      setBusy(null);
    }
  };
  return { run, busy, error, clear: () => setError(null) };
}

/** 题材和卡数存档数：“古风 · 悬疑”“1 张卡 · 3 个存档” */
function useMeta(entry: Entry) {
  const { t } = useTranslation();
  return {
    genre: entry.tags.join(" · "),
    counts: `${t("library.cardsIn", { count: entry.scenario.cards.length })} · ${t("library.savesIn", { count: entry.saves })}`,
  };
}

function ScenarioHero({
  entry,
  slot,
  cards,
  starting,
  onStart,
  onMenu,
}: {
  entry: Entry;
  slot: Slot;
  cards: ReadonlyMap<string, CardSummary>;
  starting: boolean;
  onStart: () => void;
  onMenu: (place: MenuPlace) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const context = useContextMenu(onMenu);
  const { scenario } = entry;
  const meta = useMeta(entry);
  const main = scenario.cards[0];
  const mainCard = main ? cards.get(main.card_id) : undefined;
  const protagonist = scenario.setup.protagonist.name.trim();
  return (
    <Panel hot className={styles.hero} style={slotStyle(slot)}>
      <div className={styles.heroCover} {...context}>
        <FluidCover seed={scenario.id} blobId={scenario.cover_blob_id} className={styles.fill} />
        <Pill tone="ink" label={t("library.latest")} className={styles.coverTag} />
      </div>
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          {scenario.setup.lightning ? <Pill tone="acc" label={t("scenario.lightningBadge")} /> : null}
          {meta.genre ? <Pill tone="card" label={meta.genre} /> : null}
          <span className={styles.meta}>{meta.counts}</span>
        </div>
        <Link to={scenarioPath(scenario)} className={styles.heroTitle} {...context}>
          {scenario.name}
        </Link>
        {scenario.description_preview ? (
          <Caption className={styles.heroText} clamp>
            {scenario.description_preview}
          </Caption>
        ) : null}
        {main ? (
          <div className={styles.castRow}>
            <Portrait
              name={main.name}
              seed={main.card_id}
              blobId={main.cover_blob_id}
              size={36}
              radius={8}
              className={styles.castFace}
            />
            <span className={styles.castName}>{main.name}</span>
            {mainCard?.tags.length ? <span className={styles.castNote}>{mainCard.tags.join(" · ")}</span> : null}
            {protagonist ? (
              <span className={styles.castNote}>{t("library.defaultProtagonist", { name: protagonist })}</span>
            ) : null}
          </div>
        ) : null}
        <div className={styles.heroFoot}>
          <Button label={t("library.start")} icon="play" busy={starting} onClick={onStart} />
          <Button
            label={t("library.viewSetup")}
            icon="library"
            variant="secondary"
            onClick={() => navigate(scenarioPath(scenario))}
          />
          <span className={styles.enterHint}>
            <Keycap>Enter</Keycap>
            {t("library.start")}
          </span>
        </div>
      </div>
    </Panel>
  );
}

function ScenarioTile({
  entry,
  kind,
  slot,
  onMenu,
}: {
  entry: Entry;
  kind: ScenarioCell;
  slot: Slot;
  onMenu: (place: MenuPlace) => void;
}) {
  const { t } = useTranslation();
  const context = useContextMenu(onMenu);
  const { scenario } = entry;
  const meta = useMeta(entry);
  const wide = kind === "wide";
  // 题材那一行：闪电模式的剧本在前面写“闪电”
  const genre = [scenario.setup.lightning ? t("scenario.lightningBadge") : "", meta.genre]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={scenarioPath(scenario)}
      className={cx(panelClass("white"), styles.tile, wide ? styles.wide : styles.narrow)}
      style={slotStyle(slot)}
      {...context}
    >
      <FluidCover
        seed={scenario.id}
        blobId={scenario.cover_blob_id}
        className={wide ? styles.coverLeft : styles.coverTop}
      />
      <span className={styles.tileBody}>
        {wide && genre ? <span className={styles.genre}>{genre}</span> : null}
        <span className={cx(styles.tileTitle, !wide && styles.tileTitleSmall)}>{scenario.name}</span>
        {!wide && genre ? <span className={cx(styles.genre, styles.genreSmall)}>{genre}</span> : null}
        {scenario.description_preview ? (
          <span className={cx(styles.tileText, !wide && styles.tileTextSmall)}>{scenario.description_preview}</span>
        ) : null}
        <span className={styles.metaFoot}>{meta.counts}</span>
      </span>
    </Link>
  );
}

function NewScenarioCell({ slot }: { slot: Slot }) {
  const { t } = useTranslation();
  return (
    <Link to={newScenarioPath()} className={cx(panelClass("blue"), styles.newCell)} style={slotStyle(slot)}>
      <span className={styles.newTitle}>{t("library.newScenarioPlus")}</span>
      <span className={styles.newNote}>{t("library.newScenarioNote")}</span>
    </Link>
  );
}
