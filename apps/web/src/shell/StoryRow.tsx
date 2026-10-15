/**
 * 侧栏里的一个故事：封面 36、标题、下面一行是状态（平时是相对时间）。整行是链接，⌘ / Ctrl + 点击在新标签页打开。
 * 当前打开的故事白底浮起。
 */

import { Link } from "react-router";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { GeometricCover } from "../components/Cover.tsx";
import { cx } from "../components/controls.tsx";
import styles from "./shell.module.css";

export function StoryRow({ story, current }: { story: Playthrough; current: boolean }) {
  const status = storyStatus(story);
  return (
    <Link
      to={`/play/${encodeURIComponent(story.id)}`}
      className={cx(styles.storyRow, current && styles.storyRowOn)}
      aria-current={current ? "page" : undefined}
    >
      {/* 侧栏是灰底：封面平时是白块，当前这一行变白以后封面换成灰块 */}
      <GeometricCover
        seed={story.scenario_id ?? story.id}
        width={36}
        height={36}
        surface={current ? "onFill" : "fill"}
        rounded={12}
      />
      <span className={styles.storyText}>
        <span className={styles.storyTitle}>{story.title}</span>
        {status ? (
          <span className={cx(styles.storyStatus, status.kind === "writing" ? styles.live : styles.warn)}>
            {status.kind === "writing" ? <span className={styles.liveDot} /> : null}
            {status.label}
          </span>
        ) : (
          <span className={cx(styles.storyStatus, styles.mono)}>{formatRelative(story.updated_at)}</span>
        )}
      </span>
    </Link>
  );
}
