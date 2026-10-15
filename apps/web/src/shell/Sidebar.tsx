/**
 * 侧栏（≥ 1280，或窄屏点“展开”后盖在内容上）：顶部 Logo 和收起按钮，三项导航，最近的故事（单独滚动），最底下是账户。
 * 整条侧栏都是链接。
 */

import { Link, useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { cx, IconButton } from "../components/controls.tsx";
import { useAvatars } from "../data/scenarios.ts";
import { useStories } from "../data/stories.ts";
import { useStoryActions } from "../data/storyActions.ts";
import { useApp } from "../state/AppProvider.tsx";
import { Avatar } from "./Avatar.tsx";
import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";
import { recentGroups } from "./recent.ts";
import styles from "./shell.module.css";
import { StoryRow } from "./StoryRow.tsx";

export function Sidebar({ onCollapse, overlay }: { onCollapse: () => void; overlay?: boolean }) {
  const { pathname } = useLocation();
  const { user } = useApp();
  const stories = useStories();
  const avatarOf = useAvatars();
  const actions = useStoryActions();
  const current = openStoryId(pathname);
  const groups = recentGroups(stories.data ?? []);
  return (
    <nav
      aria-label="主导航"
      className={cx(styles.sidebar, "surface-panel", overlay && styles.sidebarOverlay)}
    >
      <div className={styles.sidebarHead}>
        <Logo size={26} label={null} />
        <span className={styles.brand}>BetterTavern</span>
        <IconButton
          icon="sidebar"
          label="收起侧栏"
          tone="plain"
          diameter={36}
          iconSize={20}
          onClick={onCollapse}
        />
      </div>
      <div className={styles.navList}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cx(styles.navItem, active && styles.navItemOn)}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.icon} size={20} />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className={styles.recentLabel}>
        <span>最近的故事</span>
        {stories.data ? <span className={styles.mono}>{stories.data.length}</span> : null}
      </div>
      <div className={styles.recentList}>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <div className={styles.group}>{group.label}</div>
            {group.items.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                avatar={avatarOf(story.scenario_id)}
                current={story.id === current}
                onMenu={actions.menu}
              />
            ))}
          </section>
        ))}
      </div>
      {user ? (
        <Link to="/settings/account" className={styles.account}>
          <Avatar user={user} />
          <span className={styles.accountText}>
            <span className={styles.accountName}>{user.display_name || "未设置昵称"}</span>
            <span className={cx(styles.accountEmail, styles.mono)}>{user.email}</span>
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
