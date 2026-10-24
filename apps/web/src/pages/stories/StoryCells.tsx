/**
 * 存档页的格子（docs/design/comic 的 01，数值取自 source/ComicNav.dc.html）：
 * - hero（4 × 2）：白底墨点、加“热”的大投影。左边是“接着读”、编号和时间，剧本名（宋体 900），最近一段的摘录（旁白框），
 *   底下是“继续”和回合数；右边 300 宽是主角色的人物位（有头像用头像，没有就是名字里的一个大字压在蓝网点上）；
 * - wide（2 × 1）、small（1 × 1）：白格，编号标签、剧本名、摘录、右下角的时间；正在生成的存档换成墨底，写“● 正在写”；
 * - new：“新的故事 ＋”，蓝网点，右下角键帽 N。
 * 每一格都是指向阅读页的链接（⌘ / Ctrl + 点击、中键在新标签页打开）；“继续”只是画成按钮的样子。
 * 设计稿里主角色说的一句台词，接口里没有，先不画。
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Playthrough } from "@bettertavern/core/api/types";
import { LANGUAGE_TAGS } from "@bettertavern/core/i18n/index";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Caption, Keycap, panelClass, Portrait } from "../../components/comic.tsx";
import { buttonClass, cx, IconButton, Pill } from "../../components/controls.tsx";
import { slotStyle } from "../../components/ComicGrid.tsx";
import { Icon } from "../../components/Icon.tsx";
import { storyPath } from "../../data/storyActions.ts";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import type { SaveCell as SaveKind, Slot } from "../../theme/grid.ts";
import styles from "./stories.module.css";

/** 主角色：剧本的第一张卡 */
export type MainCast = { id: string; name: string; blobId: string | null };

function saveNumber(n: number): string {
  return String(n).padStart(2, "0");
}

/** 回合数：开场是第 0 回合 */
function TurnCount({ story }: { story: Playthrough }) {
  const { t } = useTranslation();
  if (story.head_seq === null) return null;
  return (
    <span className={styles.turnCount}>
      {story.head_seq === 0 ? t("stories.openingTurn") : t("stories.turnN", { n: story.head_seq })}
      {story.protagonist_name ? ` · ${t("play.iAm", { name: story.protagonist_name })}` : null}
    </span>
  );
}

/** 状态标签：正在写（蓝底带圆点）、开场没写好、已完结；没有状态时不画 */
function StatusPill({ story, onInk }: { story: Playthrough; onInk?: boolean }) {
  const status = storyStatus(story);
  if (status?.kind === "writing") return <Pill tone="acc" dot label={status.label} />;
  if (status?.kind === "noOpening") return <Pill tone="warn" icon="untested" label={status.label} />;
  if (status?.kind === "ended") return <Pill tone={onInk ? "acc" : "card"} icon="flag" label={status.label} />;
  return null;
}

export function SaveCell({
  story,
  number,
  kind,
  slot,
  cast,
  onMenu,
}: {
  story: Playthrough;
  number: number;
  kind: SaveKind;
  slot: Slot;
  cast: MainCast | null;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
}) {
  const { t } = useTranslation();
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu((place) => onMenu(story, place));
  const writing = storyStatus(story)?.kind === "writing";
  const lang = LANGUAGE_TAGS[story.language];
  const hero = kind === "hero";
  const tone = hero ? "dots" : writing ? "ink" : "white";
  const time = formatRelative(story.updated_at);
  const tag = `SAVE ${saveNumber(number)}`;

  let body;
  if (hero) {
    body = (
      <>
        <div className={styles.heroMain}>
          <div className={styles.tags}>
            {writing ? <StatusPill story={story} /> : <Pill tone="ink" label={t("stories.resume")} />}
            <Pill tone="acc" label={tag} />
            {story.mode === "lightning" ? <Pill tone="card" label={t("scenario.lightningBadge")} /> : null}
            {writing ? null : <StatusPill story={story} />}
            <span className={styles.label}>{time}</span>
          </div>
          <h2 className={styles.heroTitle}>{story.title}</h2>
          {story.head_excerpt ? (
            <Caption className={styles.heroExcerpt} lang={lang} clamp>
              {story.head_excerpt}
            </Caption>
          ) : null}
          <div className={styles.heroFoot}>
            <span className={buttonClass("primary")} aria-hidden="true">
              <Icon name="play" size={19} strokeWidth={2.2} />
              {t("common.continue")}
            </span>
            <TurnCount story={story} />
          </div>
        </div>
        <div className={styles.heroCast}>
          <Portrait
            name={cast?.name ?? story.title}
            seed={cast?.id ?? story.id}
            blobId={cast?.blobId}
            tone="blue"
            className={styles.heroPortrait}
          />
        </div>
      </>
    );
  } else {
    const small = kind === "small";
    body = (
      <>
        <div className={cx(styles.head, small && styles.headSmall)}>
          {writing ? (
            <>
              <StatusPill story={story} />
              <span className={cx(styles.label, styles.labelSky)}>{tag}</span>
            </>
          ) : (
            <Pill tone="card" label={tag} />
          )}
          {!small && !writing ? <h2 className={styles.title}>{story.title}</h2> : null}
          {!writing ? <StatusPill story={story} /> : null}
          {!small && story.mode === "lightning" ? (
            <Pill tone="card" label={t("scenario.lightningBadge")} />
          ) : null}
        </div>
        {small || writing ? <h2 className={cx(styles.title, writing && styles.titleLarge)}>{story.title}</h2> : null}
        {story.head_excerpt ? (
          small ? (
            <p className={styles.excerptPlain} lang={lang}>
              {story.head_excerpt}
            </p>
          ) : (
            <Caption className={cx(styles.excerpt, slot.h > 1 && styles.excerptTall)} lang={lang} clamp>
              {story.head_excerpt}
            </Caption>
          )
        ) : null}
        <span className={cx(styles.time, writing && styles.labelSky)}>{time}</span>
      </>
    );
  }

  return (
    <div className={styles.cell} style={slotStyle(slot)}>
      <Link
        to={storyPath(story)}
        className={cx(panelClass(tone, { hot: hero }), styles.save, hero && styles.hero)}
        aria-label={`${tag} ${story.title}`}
        {...context}
      >
        {body}
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={t("nav.moreFor", { title: story.title })}
        tone="card"
        diameter={32}
        iconSize={18}
        className={cx(styles.more, hero && styles.moreHero)}
        onClick={() => more.current && onMenu(story, { anchor: more.current })}
      />
    </div>
  );
}

/** “新的故事 ＋”：蓝网点，去剧本页挑一个（键 N） */
export function NewStoryCell({ slot }: { slot: Slot }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/scenarios"
      className={cx(panelClass("blue"), styles.newStory, slot.h > 1 && styles.newTall)}
      style={slotStyle(slot)}
      aria-keyshortcuts="N"
    >
      <span className={styles.newTitle}>{t("stories.newStory")}</span>
      <span className={styles.newNote}>{t("stories.newStoryNote")}</span>
      <Keycap className={styles.newKey}>N</Keycap>
    </Link>
  );
}
