/**
 * 侧栏里的一个故事：封面 36、标题、下面一行是状态（平时是相对时间）。整行是链接，⌘ / Ctrl + 点击在新标签页打开。
 * 当前打开的故事白底浮起；悬停时右侧出现 30 的白色“…”，右键打开同一个菜单（同故事卡片）。
 */

import { useRef } from "react";
import { Link } from "react-router";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../components/Cover.tsx";
import { cx, IconButton } from "../components/controls.tsx";
import { storyPath } from "../data/storyActions.ts";
import type { MenuPlace } from "../overlay/Menu.tsx";
import { useContextMenu } from "../overlay/useContextMenu.ts";
import styles from "./shell.module.css";

export function StoryRow({
  story,
  avatar,
  current,
  onMenu,
}: {
  story: Playthrough;
  avatar: string | null;
  current: boolean;
  onMenu: (story: Playthrough, place: MenuPlace) => void;
}) {
  const status = storyStatus(story);
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu((place) => onMenu(story, place));
  return (
    <div className={styles.storyCell}>
      <Link
        to={storyPath(story)}
        className={cx(styles.storyRow, current && styles.storyRowOn)}
        aria-current={current ? "page" : undefined}
        {...context}
      >
        {/* 侧栏是灰底：封面平时是白块，当前这一行变白以后封面换成灰块 */}
        <Cover
          seed={story.scenario_id ?? story.id}
          blobId={avatar}
          width={36}
          height={36}
          surface={current ? "onFill" : "fill"}
          rounded={12}
        />
        <span className={styles.storyText}>
          <span className={styles.storyTitle}>{story.title}</span>
          {status ? (
            <span
              className={cx(
                styles.storyStatus,
                status.kind === "writing" && styles.live,
                status.kind === "noOpening" && styles.warn,
              )}
            >
              {status.kind === "writing" ? <span className={styles.liveDot} /> : null}
              {status.label}
            </span>
          ) : (
            <span className={cx(styles.storyStatus, styles.mono)}>{formatRelative(story.updated_at)}</span>
          )}
        </span>
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={`“${story.title}”的更多操作`}
        tone="card"
        diameter={30}
        iconSize={18}
        className={styles.storyMore}
        onClick={() => more.current && onMenu(story, { anchor: more.current })}
      />
    </div>
  );
}
