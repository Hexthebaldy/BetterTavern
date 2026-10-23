/**
 * 侧栏：贴着窗口左边、从上到下整条的浅灰底。同一个组件有两种宽度：展开 240、收起 64（只剩图标），
 * 切换时宽度动画缩放，文字淡出，图标位置不动。
 * - 顶上：Logo、名字和收起按钮；收起后不显示这个按钮，点 Logo 展开（快捷键 [ 照旧）；
 * - 两组导航：创作（存档、剧本、角色、工作台）和连接（模型、外部服务）；选中项的底色淡入，不滑动；
 * - 展开时下面是最近的存档（单独滚动），收起时藏起来；
 * - 最下面是头像，点了弹出账户小窗（AccountMenu）。
 * overlay：窗口窄于 1280 时，展开的侧栏盖在内容上（带遮罩），内容的位置不动。
 */

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { cx, IconButton } from "../components/controls.tsx";
import { useAvatars } from "../data/scenarios.ts";
import { useStories } from "../data/stories.ts";
import { useStoryActions } from "../data/storyActions.ts";
import { useApp } from "../state/AppProvider.tsx";
import { useAccountMenu } from "./AccountMenu.tsx";
import { Avatar } from "./Avatar.tsx";
import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";
import { recentGroups } from "./recent.ts";
import styles from "./shell.module.css";
import { StoryRow } from "./StoryRow.tsx";

export function Sidebar({
  collapsed,
  overlay,
  onToggle,
}: {
  collapsed: boolean;
  overlay: boolean;
  onToggle: () => void;
}) {
  const { pathname } = useLocation();
  const { user } = useApp();
  const stories = useStories();
  const avatarOf = useAvatars();
  const actions = useStoryActions();
  const account = useAccountMenu();
  const current = openStoryId(pathname);
  const groups = recentGroups(stories.data ?? []);
  const { t } = useTranslation();
  const toggleLabel = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");
  return (
    <nav
      aria-label={t("nav.main")}
      className={cx(styles.sidebar, collapsed && styles.collapsed, overlay && styles.sidebarOverlay)}
    >
      <div className={styles.sidebarHead}>
        {collapsed ? (
          <button
            type="button"
            className={styles.logoButton}
            aria-label={toggleLabel}
            data-tip={toggleLabel}
            data-kbd="["
            aria-keyshortcuts="["
            onClick={onToggle}
          >
            <Logo size={26} label={null} />
          </button>
        ) : (
          <Link to="/playthroughs" className={styles.logoButton} aria-label="BetterTavern">
            <Logo size={26} label={null} />
          </Link>
        )}
        <span className={styles.brand}>BetterTavern</span>
        {collapsed ? null : (
          <IconButton
            icon="sidebar"
            label={toggleLabel}
            aria-keyshortcuts="["
            tone="plain"
            diameter={36}
            iconSize={20}
            onClick={onToggle}
          />
        )}
      </div>
      <div className={styles.navList}>
        {NAV_ITEMS.map((item, index) => {
          const active = isActive(item, pathname);
          const label = t(`nav.${item.name}`);
          const startsGroup = index > 0 && NAV_ITEMS[index - 1]?.group !== item.group;
          return (
            <Fragment key={item.to}>
              {startsGroup ? (
                <div className={styles.navGroup} role="presentation">
                  <span className={styles.fade}>{t(`nav.groups.${item.group}`)}</span>
                </div>
              ) : null}
              <Link
                to={item.to}
                className={cx(styles.navItem, active && styles.navItemOn)}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                data-tip={collapsed ? label : undefined}
              >
                <Icon name={item.icon} size={20} />
                <span className={styles.fade}>{label}</span>
              </Link>
            </Fragment>
          );
        })}
      </div>
      <div className={styles.recent} aria-hidden={collapsed || undefined}>
        <div className={styles.recentLabel}>
          <span>{t("nav.recent")}</span>
          {stories.data ? <span className={styles.mono}>{stories.data.length}</span> : null}
        </div>
        <div className={styles.recentList}>
          {groups.map((group) => (
            <section key={group.key} aria-label={t(`nav.recentGroups.${group.key}`)}>
              <div className={styles.group}>{t(`nav.recentGroups.${group.key}`)}</div>
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
      </div>
      {user ? (
        <button
          type="button"
          className={styles.account}
          aria-haspopup="dialog"
          aria-expanded={account.isOpen}
          aria-label={collapsed ? t("nav.account") : undefined}
          data-tip={collapsed ? t("nav.account") : undefined}
          onClick={(event) => account.open(event.currentTarget)}
        >
          <Avatar user={user} />
          <span className={cx(styles.accountText, styles.fade)}>
            <span className={styles.accountName}>{user.display_name || t("nav.noNickname")}</span>
            <span className={cx(styles.accountEmail, styles.mono)}>{user.email}</span>
          </span>
        </button>
      ) : null}
      {account.element}
    </nav>
  );
}
