/**
 * 导航条（900–1279，或用户收起侧栏后）：Logo、展开侧栏、三项导航、分隔线、最近四个故事的封面、底部头像。
 * 当前故事的封面白底浮起，正在写的右上角有蓝点。
 */

import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { storyStatus } from "@bettertavern/core/play/storyStatus";
import type { Playthrough } from "@bettertavern/core/api/types";

import { Cover } from "../components/Cover.tsx";
import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { cx, IconButton } from "../components/controls.tsx";
import { useAvatars } from "../data/scenarios.ts";
import { useStories } from "../data/stories.ts";
import { storyPath, useStoryActions } from "../data/storyActions.ts";
import type { MenuPlace } from "../overlay/Menu.tsx";
import { useContextMenu } from "../overlay/useContextMenu.ts";
import { useApp } from "../state/AppProvider.tsx";
import { Avatar } from "./Avatar.tsx";
import { useGlass } from "./glass.tsx";
import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";
import { byRecent } from "./recent.ts";
import styles from "./shell.module.css";

export function Rail({ onExpand }: { onExpand: () => void }) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { user } = useApp();
  const stories = useStories();
  const avatarOf = useAvatars();
  const actions = useStoryActions();
  const current = openStoryId(pathname);
  const recent = byRecent(stories.data ?? []).slice(0, 4);
  const { ref, glass } = useGlass(NAV_ITEMS.find((item) => isActive(item, pathname))?.to ?? null);
  return (
    <nav aria-label={t("nav.main")} className={cx(styles.rail, "surface-panel")}>
      <Logo size={28} />
      <IconButton
        icon="sidebar"
        label={t("nav.expandSidebar")}
        aria-keyshortcuts="["
        tone="plain"
        iconSize={20}
        className={styles.railExpand}
        onClick={onExpand}
      />
      {glass}
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.to}
            ref={ref(item.to)}
            to={item.to}
            className={cx(styles.railItem, active && styles.railItemOn)}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={22} />
            {t(`nav.${item.name}`)}
          </Link>
        );
      })}
      {recent.length > 0 ? <span className={styles.railRule} /> : null}
      {recent.map((story) => (
        <RailCover
          key={story.id}
          story={story}
          avatar={avatarOf(story.scenario_id)}
          current={story.id === current}
          onMenu={actions.menu}
        />
      ))}
      {user ? (
        <Link
          to="/settings/account"
          className={styles.railAccount}
          aria-label={t("settings.account")}
          title={user.email}
        >
          <Avatar user={user} />
        </Link>
      ) : null}
    </nav>
  );
}

/** 导航条上的一个封面：链接到阅读页；当前故事白底浮起，正在写的右上角有蓝点；右键打开故事菜单 */
function RailCover({
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
  const context = useContextMenu((place) => onMenu(story, place));
  return (
    <Link
      to={storyPath(story)}
      className={cx(styles.railCover, current && styles.railCoverOn)}
      aria-label={story.title}
      data-tip={story.title}
      aria-current={current ? "page" : undefined}
      {...context}
    >
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={36}
        height={36}
        surface={current ? "onFill" : "fill"}
        rounded={12}
      />
      {storyStatus(story)?.kind === "writing" ? <span className={styles.railLive} /> : null}
    </Link>
  );
}
