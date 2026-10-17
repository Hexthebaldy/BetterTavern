/**
 * 剧本详情（W05，同平板 T12）：封面、角色卡概要、原卡的开场白，以及“开始新的故事”的五步表单。
 * 开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 *
 * - ≥ 900：两栏各自滚动。左栏 420 是封面（高 236，返回按钮浮在上面）、名字、标签、统计、简介、原卡开场白；
 *   右栏是五步表单，底部浮着摘要栏（已选项胶囊加“开始故事”），圆角 34，带投影。
 * - 更窄：单栏，最宽 640，居中。
 * 侧栏一直在，返回按钮回到剧本库。剧本名右边是“编辑角色卡”（EditCardPage.tsx，剧本名也在那里改），
 * 改过的卡标题上方注明“已编辑”；删除剧本的按钮在概要下面（单栏时在页面最底下）。
 * 文案同 App 的 app/scenario/[id]/index.tsx。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { scenarioPath, useScenarioActions } from "../../data/scenarioActions.ts";
import { storiesKey } from "../../data/stories.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { desktop, shell } from "../../theme/layout.ts";
import styles from "./scenario.module.css";
import { StartForm, type StartValues } from "./StartForm.tsx";

/** 角色卡里可能被截断的字段 */
const FIELD_NAMES: Record<string, string> = {
  description: "描述",
  personality: "性格",
  scenario: "场景",
  first_mes: "开场白",
  mes_example: "对话示例",
  system_prompt: "系统提示",
  post_history_instructions: "历史后指令",
  creator_notes: "作者备注",
};

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
          {expanded ? "收起" : "展开全文"}
          <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} />
        </button>
      ) : null}
    </>
  );
}

function Overview({ scenario, onEdit }: { scenario: Scenario; onEdit: () => void }) {
  const truncated = scenario.truncated_fields;
  return (
    <>
      <div className={styles.titleBlock}>
        <span className={styles.caption}>
          角色卡{scenario.creator ? ` · 作者 ${scenario.creator}` : ""}
          {scenario.edited_at ? " · 已编辑" : ""}
        </span>
        <div className={styles.titleRow}>
          <h1 className={styles.hero}>{scenario.name}</h1>
          <Button label="编辑角色卡" icon="write" variant="secondary" size="sm" onClick={onEdit} />
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
        <Stat icon="world" value={scenario.book_entries} label="世界书条目" />
        <Stat icon="greeting" value={1 + scenario.alternate_greetings} label="开场白" />
        {truncated.length > 0 ? (
          <Stat icon="truncated" value={truncated.length} label="字段被截断" warn />
        ) : null}
      </div>
      {scenario.description_preview || truncated.length > 0 ? (
        <div className={cx(styles.card, styles.description, "surface-panel")}>
          {scenario.description_preview ? <Description text={scenario.description_preview} /> : null}
          {truncated.length > 0 ? (
            <div className={styles.warn}>
              <Icon name="alert" size={16} />
              <span>
                {truncated.map((f) => `“${FIELD_NAMES[f] ?? f}”`).join("、")}字段太长，只保留了前面的部分。
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {scenario.first_mes_preview ? (
        <div className={cx(styles.card, styles.greeting)}>
          <span className={styles.caption}>原卡的开场白</span>
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
  useDocumentTitle(scenario?.name ?? "剧本");

  if (!scenario) {
    return (
      <div className={styles.single}>
        <IconButton icon="back" label="返回剧本库" onClick={() => navigate("/library")} />
        {query.isPending ? null : (
          <Notice
            message={`剧本没加载出来：${describeError(query.error)}`}
            actionLabel="重新加载"
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
        blobId={scenario.avatar_blob_id}
        width={coverWidth}
        height={wide ? 236 : Math.round(coverWidth * 0.82)}
        rounded={34}
      />
      <div className={styles.coverBar}>
        <IconButton
          icon="back"
          label="返回剧本库"
          tone="card"
          diameter={44}
          onClick={() => navigate("/library")}
        />
      </div>
    </div>
  );
  const startHead = (
    <div className={styles.startHead}>
      <h2 className={styles.startTitle}>开始新的故事</h2>
      <span className={styles.caption}>只有第 1 步必填</span>
    </div>
  );
  const form = (
    <StartForm
      wide={wide}
      onChange={(next, parts) => {
        setValues(next);
        setSummary(parts);
      }}
    />
  );
  const errorNotice = startError ? (
    <Notice
      message={routeMissing ? "没有可用模型" : describeError(startError)}
      actionLabel={routeMissing ? "去设置" : undefined}
      onAction={routeMissing ? () => navigate("/settings/models") : undefined}
    />
  ) : null;
  const pills = (
    <div className={styles.summary} aria-label={`将要开始：${summary.join("，")}`}>
      {summary.map((part) => (
        <Pill key={part} label={part} />
      ))}
    </div>
  );
  const startButton = (
    <Button
      label="开始故事"
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
        label="删除剧本"
        variant="danger"
        icon="trash"
        className={styles.dangerButton}
        onClick={() => void actions.remove(scenario)}
      />
      <span className={styles.caption}>已有的存档不受影响。</span>
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
