/**
 * 导航条（900–1279，或用户收起侧栏后）：Logo、展开侧栏、三项导航、分隔线、最近四个故事的封面、底部头像。
 * 当前故事的封面白底浮起，正在写的右上角有蓝点。
 */

import { Link, useLocation } from "react-router";

import { storyStatus } from "@bettertavern/core/play/storyStatus";

import { GeometricCover } from "../components/Cover.tsx";
import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { cx, IconButton } from "../components/controls.tsx";
import { useStories } from "../data/stories.ts";
import { useApp } from "../state/AppProvider.tsx";
import { Avatar } from "./Avatar.tsx";
import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";
import { byRecent } from "./recent.ts";
import styles from "./shell.module.css";

export function Rail({ onExpand }: { onExpand: () => void }) {
  const { pathname } = useLocation();
  const { user } = useApp();
  const stories = useStories();
  const current = openStoryId(pathname);
  const recent = byRecent(stories.data ?? []).slice(0, 4);
  return (
    <nav aria-label="主导航" className={cx(styles.rail, "surface-panel")}>
      <Logo size={28} />
      <IconButton
        icon="sidebar"
        label="展开侧栏"
        tone="plain"
        iconSize={20}
        className={styles.railExpand}
        onClick={onExpand}
      />
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cx(styles.railItem, active && styles.railItemOn)}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={22} />
            {item.label}
          </Link>
        );
      })}
      {recent.length > 0 ? <span className={styles.railRule} /> : null}
      {recent.map((story) => (
        <Link
          key={story.id}
          to={`/play/${encodeURIComponent(story.id)}`}
          className={cx(styles.railCover, story.id === current && styles.railCoverOn)}
          aria-label={story.title}
          title={story.title}
          aria-current={story.id === current ? "page" : undefined}
        >
          <GeometricCover
            seed={story.scenario_id ?? story.id}
            width={36}
            height={36}
            surface={story.id === current ? "onFill" : "fill"}
            rounded={12}
          />
          {storyStatus(story)?.kind === "writing" ? <span className={styles.railLive} /> : null}
        </Link>
      ))}
      {user ? (
        <Link to="/settings/account" className={styles.railAccount} aria-label="账户" title={user.email}>
          <Avatar user={user} />
        </Link>
      ) : null}
    </nav>
  );
}
