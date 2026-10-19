/**
 * 剧本详情（W05，同平板 T12）：封面、角色卡概要、原卡的开场白，以及“开始新的故事”的五步表单。
 * 开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 *
 * - ≥ 900：两栏各自滚动。左栏 420 是封面（高 236，返回按钮浮在上面）、名字、标签、统计、简介、原卡开场白；
 *   右栏是五步表单，底部浮着摘要栏（已选项胶囊加“开始故事”），圆角 34，带投影。
 * - 更窄：单栏，最宽 640，居中。
 * 侧栏一直在，返回按钮回到剧本库。剧本名右边是“编辑角色卡”（EditCardPage.tsx，剧本名也在那里改），
 * 改过的卡标题上方注明“已编辑”；删除剧本的按钮在概要下面（单栏时在页面最底下）。
 * 还没有导演模型时，“开始新的故事”标题下面先有一条琥珀色提示和“去设置”；填了一半的表单在这个标签页里留着，配好回来还在。
 * 文案同 App 的 app/scenario/[id]/index.tsx。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { currentLanguage, lookup } from "@bettertavern/core/i18n/index";
import { needsDirector } from "@bettertavern/core/scenario/startForm";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { useModelRoutes } from "../../data/models.ts";
import { scenarioPath, useScenarioActions } from "../../data/scenarioActions.ts";
import { storiesKey } from "../../data/stories.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { desktop, shell } from "../../theme/layout.ts";
import styles from "./scenario.module.css";
import { forgetStartForm, StartForm, type StartValues } from "./StartForm.tsx";

function isRouteMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ROUTE_MISSING";
}

/** 角色卡里可能被截断的字段 */
function fieldName(field: string): string {
  return lookup(`scenario.fields.${field}`) ?? field;
}

function Stat({
  icon,
  value,
  label,
  warn,
}: {
  icon: IconName;
  value: number;
  label: string;
  warn?: boolean;
}) {
  return (
    <div className={cx(styles.stat, warn && styles.statWarn)}>
      <Icon name={icon} />
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

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

function Overview({ scenario, onEdit }: { scenario: Scenario; onEdit: () => void }) {
  const truncated = scenario.truncated_fields;
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.titleBlock}>
        <span className={styles.caption}>
          {[
            t("scenario.card"),
            scenario.creator ? t("scenario.creator", { creator: scenario.creator }) : null,
            scenario.edited_at ? t("scenario.edited") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <div className={styles.titleRow}>
          <h1 className={styles.hero}>{scenario.name}</h1>
          <Button
            label={t("scenario.editCard")}
            icon="write"
            variant="secondary"
            size="sm"
            onClick={onEdit}
          />
        </div>
        {scenario.tags.length > 0 ? (
          <div className={styles.tags}>
            {scenario.tags.slice(0, 8).map((tag) => (
              <Pill key={tag} label={tag} className={styles.tag} />
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.stats}>
        <Stat icon="world" value={scenario.book_entries} label={t("scenario.bookEntries")} />
        <Stat icon="greeting" value={1 + scenario.alternate_greetings} label={t("scenario.greetings")} />
        {truncated.length > 0 ? (
          <Stat icon="truncated" value={truncated.length} label={t("scenario.truncatedFields")} warn />
        ) : null}
      </div>
      {scenario.description_preview || truncated.length > 0 ? (
        <div className={cx(styles.card, styles.description, "surface-panel")}>
          {scenario.description_preview ? <Description text={scenario.description_preview} /> : null}
          {truncated.length > 0 ? (
            <div className={styles.warn}>
              <Icon name="alert" size={16} />
              <span>
                {t("scenario.truncatedNote", {
                  fields: truncated.map((f) => `“${fieldName(f)}”`).join(t("common.listSeparator")),
                })}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {scenario.first_mes_preview ? (
        <div className={cx(styles.card, styles.greeting)}>
          <span className={styles.caption}>{t("scenario.originalGreeting")}</span>
          <p className={styles.greetingText}>{scenario.first_mes_preview}</p>
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
  // 有没有导演模型：取不到列表时不提示，仍靠服务端的 ROUTE_MISSING 兜底；回到页面时 react-query 会重新取
  const routes = useModelRoutes();
  const noDirector = needsDirector(routes.data);
  const hasDirector = routes.data?.some((route) => route.is_director) ?? false;
  useEffect(() => {
    // 每次取到列表都看一眼：配好了导演，之前点“开始故事”留下的 ROUTE_MISSING 不再挂着
    if (hasDirector) setStartError((e: unknown) => (isRouteMissing(e) ? null : e));
  }, [hasDirector, routes.dataUpdatedAt]);

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
      forgetStartForm(scenario.id);
      void queries.invalidateQueries({ queryKey: storiesKey });
      navigate(`/play/${encodeURIComponent(created.playthrough.id)}`, { replace: true });
    } catch (e) {
      setStartError(e);
      setStarting(false);
    }
  };

  const edit = (): void => void navigate(`${scenarioPath(scenario)}/edit`);
  const routeMissing = isRouteMissing(startError);
  const coverWidth = wide ? shell.scenarioInfo : Math.min(width - 24, shell.readable);
  const cover = (
    <div className={styles.cover}>
      <Cover
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
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
  const directorNotice = noDirector ? (
    <Notice
      tone="warn"
      message={t("start.needDirector")}
      actionLabel={t("start.goSettings")}
      onAction={() => navigate("/settings/models")}
      className={styles.directorNotice}
    />
  ) : null;
  const form = (
    <StartForm
      scenarioId={scenario.id}
      wide={wide}
      onChange={(next, parts) => {
        setValues(next);
        setSummary(parts);
      }}
    />
  );
  // 上面已经提示了没有导演：点“开始故事”报的 ROUTE_MISSING 不再重复一遍
  const errorNotice =
    startError && !(routeMissing && noDirector) ? (
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
            {directorNotice}
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
      {directorNotice}
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
