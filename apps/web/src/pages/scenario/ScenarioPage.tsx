/**
 * 剧本详情（W05，同平板 T12）：封面、剧本里的角色卡（第一张是主角色，点一下看卡）、剧本设置（默认主角、偏好、开场），
 * 以及“开始新的故事”的五步表单（按剧本设置预填）。开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 *
 * - ≥ 900：两栏各自滚动。左栏 420 是封面（高 236，返回按钮浮在上面）、名字、角色卡、设置、简介；
 *   右栏是五步表单，底部浮着摘要栏（已选项胶囊加“开始故事”），圆角 34，带投影。
 * - 更窄：单栏，最宽 640，居中。
 * 剧本名右边是“编辑设置”（ScenarioFormPage.tsx）；删除剧本的按钮在概要下面（单栏时在页面最底下）。
 * 剧本实时引用角色卡：卡保存了新版本以后，新开的故事用新内容。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { currentLanguage, i18n } from "@bettertavern/core/i18n/index";
import { lengthLabel, splitJoined } from "@bettertavern/core/scenario/startForm";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { scenarioPath, useScenarioActions } from "../../data/scenarioActions.ts";
import { storiesKey } from "../../data/stories.ts";
import { cardPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { desktop, shell } from "../../theme/layout.ts";
import styles from "./scenario.module.css";
import { StartForm, type StartValues } from "./StartForm.tsx";

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const [clamped, setClamped] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const node = box.current;
    if (node && !expanded) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, expanded]);
  return (
    <>
      <p ref={box} className={cx(styles.descriptionText, !expanded && styles.clamped)}>
        {text}
      </p>
      {clamped || expanded ? (
        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("scenario.collapse") : t("scenario.expand")}
          <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} />
        </button>
      ) : null}
    </>
  );
}

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
  const { t } = useTranslation();
  const { protagonist, preferences } = scenario.setup;
  const prefs = [
    lengthLabel(preferences.length),
    preferences.style,
    preferences.boundaries ? t("start.avoid", { count: splitJoined(preferences.boundaries).length }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className={styles.titleBlock}>
        <div className={styles.titleRow}>
          <h1 className={styles.hero}>{scenario.name}</h1>
          <Button label={t("scenario.editSetup")} icon="write" variant="secondary" size="sm" onClick={onEdit} />
        </div>
      </div>
      <div className={styles.cast}>
        {scenario.cards.map((card, i) => (
          <Link key={card.card_id} to={cardPath(card.card_id)} className={styles.castRow} aria-label={t("scenario.openCard")}>
            <Cover seed={card.card_id} blobId={card.cover_blob_id} width={44} height={44} surface="onFill" />
            <span className={styles.castBody}>
              <span className={styles.castName}>{card.name}</span>
            </span>
            {i === 0 && scenario.cards.length > 1 ? <Pill label={t("scenario.lead")} tone="acc" /> : null}
            <Icon name="chevronRight" size={16} />
          </Link>
        ))}
      </div>
      <h2 className={styles.sectionLabel}>{t("scenario.setup")}</h2>
      <div className={styles.setup}>
        <div className={styles.setupRow}>
          <span className={styles.caption}>{t("scenario.protagonist")}</span>
          <span className={styles.setupValue}>
            {protagonist.name
              ? [protagonist.name, protagonist.summary].filter(Boolean).join(" · ")
              : t("scenario.noProtagonist")}
          </span>
        </div>
        <div className={styles.setupRow}>
          <span className={styles.caption}>{t("scenario.preferences")}</span>
          <span className={styles.setupValue}>{prefs}</span>
        </div>
        <div className={styles.setupRow}>
          <span className={styles.caption}>{t("scenario.opening")}</span>
          <span className={styles.setupValue}>{openingText(scenario)}</span>
        </div>
      </div>
      {scenario.description_preview ? (
        <div className={cx(styles.card, styles.description, "surface-panel")}>
          <Description text={scenario.description_preview} />
        </div>
      ) : null}
    </>
  );
}

export function ScenarioPage() {
  const { id = "" } = useParams();
  const { api } = useApp();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const actions = useScenarioActions();
  const width = useWindowWidth();
  const wide = width >= desktop.rail;
  const query = useQuery({ queryKey: ["scenario", id], queryFn: () => api.scenarios.get(id) });
  const scenario = query.data;
  const [values, setValues] = useState<StartValues | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const { t } = useTranslation();
  useDocumentTitle(scenario?.name ?? t("nav.library"));

  if (!scenario) {
    return (
      <div className={styles.single}>
        <IconButton icon="back" label={t("scenario.backToLibrary")} onClick={() => navigate("/library")} />
        {query.isPending ? null : (
          <Notice
            message={t("scenario.loadFailedWith", { error: describeError(query.error) })}
            actionLabel={t("common.reload")}
            onAction={() => void query.refetch()}
            className={styles.loadError}
          />
        )}
      </div>
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
      void queries.invalidateQueries({ queryKey: storiesKey });
      navigate(`/play/${encodeURIComponent(created.playthrough.id)}`, { replace: true });
    } catch (e) {
      setStartError(e);
      setStarting(false);
    }
  };

  const edit = (): void => void navigate(`${scenarioPath(scenario)}/edit`);
  const routeMissing = startError instanceof ApiError && startError.code === "ROUTE_MISSING";
  const coverWidth = wide ? shell.scenarioInfo : Math.min(width - 24, shell.readable);
  const cover = (
    <div className={styles.cover}>
      <Cover
        seed={scenario.id}
        blobId={scenario.cover_blob_id}
        width={coverWidth}
        height={wide ? 236 : Math.round(coverWidth * 0.82)}
        rounded={34}
      />
      <div className={styles.coverBar}>
        <IconButton
          icon="back"
          label={t("scenario.backToLibrary")}
          tone="card"
          diameter={44}
          onClick={() => navigate("/library")}
        />
      </div>
    </div>
  );
  const startHead = (
    <div className={styles.startHead}>
      <h2 className={styles.startTitle}>{t("start.title")}</h2>
      <span className={styles.caption}>{t("start.hint")}</span>
    </div>
  );
  const { protagonist, preferences } = scenario.setup;
  const form = (
    <StartForm
      key={scenario.version}
      wide={wide}
      initial={{ name: protagonist.name, summary: protagonist.summary, ...preferences }}
      onChange={(next, parts) => {
        setValues(next);
        setSummary(parts);
      }}
    />
  );
  const errorNotice = startError ? (
    <Notice
      message={routeMissing ? t("start.noModel") : describeError(startError)}
      actionLabel={routeMissing ? t("start.goSettings") : undefined}
      onAction={routeMissing ? () => navigate("/settings/models") : undefined}
    />
  ) : null;
  const pills = (
    <div
      className={styles.summary}
      aria-label={t("start.willStart", { summary: summary.join(t("common.listSeparator")) })}
    >
      {summary.map((part) => (
        <Pill key={part} label={part} />
      ))}
    </div>
  );
  const startButton = (
    <Button
      label={t("start.button")}
      size="lg"
      between
      trailingIcon="arrowRight"
      busy={starting}
      disabled={!values?.name}
      className={styles.startButton}
      onClick={() => void start()}
    />
  );
  const danger = (
    <div className={styles.danger}>
      <Button
        label={t("scenario.deleteScenario")}
        variant="danger"
        icon="trash"
        className={styles.dangerButton}
        onClick={() => void actions.remove(scenario)}
      />
      <span className={styles.caption}>{t("library.deleteMessage")}</span>
    </div>
  );

  if (wide) {
    return (
      <div className={styles.split}>
        <aside className={styles.info}>
          {cover}
          <Overview scenario={scenario} onEdit={edit} />
          {danger}
        </aside>
        <div className={styles.formColumn}>
          <div className={styles.formScroll}>
            {startHead}
            {form}
          </div>
          <div className={styles.floatingBar}>
            {errorNotice}
            <div className={styles.barRow}>
              {pills}
              {startButton}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.single}>
      {cover}
      <Overview scenario={scenario} onEdit={edit} />
      {startHead}
      {form}
      <div className={styles.submit}>
        {errorNotice}
        {pills}
        {startButton}
      </div>
      {danger}
    </div>
  );
}
