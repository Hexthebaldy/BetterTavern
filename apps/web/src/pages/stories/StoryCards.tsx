/**
 * 存档网格里的卡片（W03，同平板 T03 和 App 的 StoryCards.tsx）：小卡高 184，最近一个存档放大成主卡（占两列两行）。
 * 两种卡片的第一行都是标题、紧跟着的状态胶囊，右上角是更新时间；“…”在右下角（悬停或键盘焦点时出现，触屏上一直在）。
 * 小卡：第一行左边是 56 的方形封面，下面是最新一段的开头，最多 3 行。主卡：方形封面撑满卡片高度（332），
 * 右边是标题行和宋体的最新一段，整张卡都是链接，没有按钮。
 * 卡片就是指向阅读页的链接，⌘ / Ctrl + 点击、中键在新标签页打开；右键打开和“…”同一个菜单。
 */

import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { cx, IconButton, Pill } from "../../components/controls.tsx";
import { storyPath } from "../../data/storyActions.ts";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import styles from "./stories.module.css";

/** 主卡的方形封面：主卡高（两格 184 加间距 12）减去上下内边距 24 */
const HERO_COVER = 184 * 2 + 12 - 24 * 2;

function Status({ story }: { story: Playthrough }) {
  const status = storyStatus(story);
  const c = styles.pill;
  if (status?.kind === "writing") return <Pill tone="acc" dot label={status.label} className={c} />;
  if (status?.kind === "noOpening")
    return <Pill tone="warn" icon="untested" label={status.label} className={c} />;
  if (status?.kind === "ended") return <Pill tone="card" icon="flag" label={status.label} className={c} />;
  return null;
}

/** 第一行：标题、状态胶囊，右上角是更新时间 */
function TitleRow({ story, hero }: { story: Playthrough; hero?: boolean }) {
  return (
    <div className={cx(styles.titleRow, hero && styles.heroTitleRow)}>
      <span className={hero ? styles.heroTitle : styles.title}>{story.title}</span>
      <Status story={story} />
      <span className={styles.time}>{formatRelative(story.updated_at)}</span>
    </div>
  );
}

/** 卡片外壳：链接本身，加上悬停才出现的“…”（按钮不能放在链接里面，所以是兄弟节点） */
function CardFrame({
  story,
  hero,
  onMenu,
  children,
}: {
  story: Playthrough;
  hero?: boolean;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
  children: ReactNode;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu((place) => onMenu(story, place));
  const { t } = useTranslation();
  return (
    <div className={cx(styles.cell, hero && styles.heroCell)}>
      <Link to={storyPath(story)} className={cx(styles.card, hero && styles.hero)} {...context}>
        {children}
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={t("nav.moreFor", { title: story.title })}
        tone="card"
        diameter={32}
        iconSize={18}
        className={styles.more}
        onClick={() => more.current && onMenu(story, { anchor: more.current })}
      />
    </div>
  );
}

export function StoryCard({
  story,
  avatar,
  onMenu,
}: {
  story: Playthrough;
  avatar: string | null;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
}) {
  return (
    <CardFrame story={story} onMenu={onMenu}>
      <div className={styles.top}>
        <Cover seed={story.scenario_id ?? story.id} blobId={avatar} width={56} height={56} surface="onFill" />
        <TitleRow story={story} />
      </div>
      {story.head_excerpt ? <p className={styles.excerpt}>{story.head_excerpt}</p> : null}
    </CardFrame>
  );
}

export function StoryHero({
  story,
  avatar,
  onMenu,
}: {
  story: Playthrough;
  avatar: string | null;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
}) {
  return (
    <CardFrame story={story} hero onMenu={onMenu}>
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={HERO_COVER}
        height={HERO_COVER}
        surface="onFill"
        rounded={24}
      />
      <div className={styles.heroBody}>
        <TitleRow story={story} hero />
        {story.head_excerpt ? <p className={styles.heroExcerpt}>{story.head_excerpt}</p> : null}
      </div>
    </CardFrame>
  );
}
