/**
 * 故事网格里的卡片（W03，同平板 T03）：小卡高 184，最近一个故事放大成主卡（占两列两行）。
 * 卡片就是指向阅读页的链接，⌘ / Ctrl + 点击、中键在新标签页打开；悬停时右上角出现“…”，右键打开同一个菜单。
 */

import { useRef, type ReactNode } from "react";
import { Link } from "react-router";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { cx, IconButton, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { storyPath } from "../../data/storyActions.ts";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import styles from "./stories.module.css";

function Status({ story }: { story: Playthrough }) {
  const status = storyStatus(story);
  if (status?.kind === "writing") return <Pill tone="acc" dot label={status.label} />;
  if (status?.kind === "noOpening") return <Pill tone="warn" icon="untested" label={status.label} />;
  if (status?.kind === "ended") return <Pill tone="card" icon="flag" label={status.label} />;
  return null;
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
  return (
    <div className={cx(styles.cell, hero && styles.heroCell)}>
      <Link to={storyPath(story)} className={cx(styles.card, hero && styles.hero)} {...context}>
        {children}
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={`“${story.title}”的更多操作`}
        tone="card"
        diameter={36}
        iconSize={20}
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
        <div className={styles.titleBox}>
          <span className={styles.title}>{story.title}</span>
          <span className={styles.time}>{formatRelative(story.updated_at)}</span>
        </div>
      </div>
      <Status story={story} />
      {story.head_excerpt ? <p className={styles.excerpt}>{story.head_excerpt}</p> : null}
    </CardFrame>
  );
}

export function StoryHero({
  story,
  avatar,
  coverSize,
  onMenu,
}: {
  story: Playthrough;
  avatar: string | null;
  /** 封面边长：宽屏 148，中屏 132 */
  coverSize: number;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
}) {
  return (
    <CardFrame story={story} hero onMenu={onMenu}>
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={coverSize}
        height={coverSize}
        surface="onFill"
        rounded={24}
      />
      <div className={styles.heroBody}>
        <div className={styles.heroTitleRow}>
          <span className={styles.heroTitle}>{story.title}</span>
          <span className={styles.time}>{formatRelative(story.updated_at)}</span>
        </div>
        <Status story={story} />
        {story.head_excerpt ? <p className={styles.heroExcerpt}>{story.head_excerpt}</p> : null}
        <span className={styles.spacer} />
        {/* 整张卡都是链接，这里只是看起来像按钮 */}
        <span className={styles.go} aria-hidden="true">
          继续读
          <span className={styles.goArrow}>
            <Icon name="arrowRight" size={18} />
          </span>
        </span>
      </div>
    </CardFrame>
  );
}
