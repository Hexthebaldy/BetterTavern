/**
 * 存档（W03）：三列网格，最近一个存档放大成主卡占两列两行；600–899 两列，主卡占满一行；手机一列，没有主卡。
 * 没有下拉刷新：回到标签页时自动刷新。空状态、加载失败的文案同 App 的 app/(tabs)/playthroughs.tsx。
 */

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { Button, Notice } from "../../components/controls.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAvatars } from "../../data/scenarios.ts";
import { useStories } from "../../data/stories.ts";
import { useStoryActions } from "../../data/storyActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { byRecent } from "../../shell/recent.ts";
import pages from "../pages.module.css";
import { StoryCard, StoryHero } from "./StoryCards.tsx";
import styles from "./stories.module.css";

function Skeleton() {
  return (
    <div className={styles.grid} aria-hidden="true">
      {[0.8, 0.5].map((opacity, i) => (
        <div key={i} className={styles.skeleton} style={{ opacity }}>
          <span className={styles.skeletonCover} />
          <span className={styles.skeletonLine} style={{ width: i === 0 ? "45%" : "35%" }} />
          <span className={styles.skeletonLine} style={{ width: "90%", height: 10 }} />
        </div>
      ))}
    </div>
  );
}

function Empty() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className={styles.empty}>
      <svg
        width="100%"
        height={150}
        viewBox="0 0 294 150"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <rect width={294} height={150} rx={24} fill="var(--card)" />
        <path
          d="M147 40c-14-10-34-14-60-14v84c26 0 46 4 60 14 14-10 34-14 60-14V26c-26 0-46 4-60 14z"
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path d="M147 40v84" stroke="var(--ink)" strokeWidth={2} />
        <path
          d="M104 56h28M104 70h22M162 56h28M162 70h20"
          stroke="var(--line2)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle cx={214} cy={40} r={10} fill="var(--acc)" />
      </svg>
      <h2 className={styles.emptyTitle}>{t("stories.emptyTitle")}</h2>
      <p className={styles.emptyText}>{t("stories.emptyText")}</p>
      <Button
        label={t("stories.emptyAction")}
        trailingIcon="arrowRight"
        between
        onClick={() => navigate("/library")}
      />
    </div>
  );
}

export function StoriesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.saves"));
  const stories = useStories();
  const avatarOf = useAvatars();
  const actions = useStoryActions();
  const width = useWindowWidth();
  const list = stories.data ? byRecent(stories.data) : null;
  const onMenu = actions.menu;
  const failure = stories.error
    ? stories.error instanceof ApiError && stories.error.isNetwork
      ? t("stories.offlineShort")
      : describeError(stories.error)
    : null;
  const [first, ...others] = list ?? [];
  const withHero = width >= 600 && first !== undefined;

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.saves")} count={list?.length ?? null} />
      {failure ? (
        <Notice
          icon="offline"
          message={failure}
          actionLabel={list ? t("common.retry") : t("common.reload")}
          onAction={() => void stories.refetch()}
          className={styles.notice}
        />
      ) : null}
      {!list ? (
        stories.isPending ? (
          <Skeleton />
        ) : null
      ) : list.length === 0 ? (
        <Empty />
      ) : (
        <div className={styles.grid}>
          {withHero ? <StoryHero story={first} avatar={avatarOf(first.scenario_id)} onMenu={onMenu} /> : null}
          {(withHero ? others : list).map((story) => (
            <StoryCard key={story.id} story={story} avatar={avatarOf(story.scenario_id)} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}
