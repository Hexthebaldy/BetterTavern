/**
 * 更新横幅：线上更新前 10 分钟开始显示（packages/core/src/notice/updateNotice.ts）。挂在路由外面，登录页和阅读页都有；
 * 浮在页面顶部，不占布局。只在标签页可见时读，回到标签页时马上读一次。关掉以后这一次更新不再显示。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  loadUpdateNotice,
  NOTICE_POLL_MS,
  noticeView,
  type UpdateNoticeView,
} from "@bettertavern/core/notice/updateNotice";

import { IconButton } from "../components/controls.tsx";
import { Icon } from "../components/Icon.tsx";
import styles from "./updateBanner.module.css";

function useUpdateNotice(): UpdateNoticeView | null {
  const [view, setView] = useState<UpdateNoticeView | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = async (): Promise<void> => {
      const notice = await loadUpdateNotice("", (url, init) => fetch(url, init));
      if (!stopped) setView(noticeView(notice, Date.now()));
    };
    const follow = (): void => {
      clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      void check();
      timer = setInterval(() => void check(), NOTICE_POLL_MS);
    };
    follow();
    document.addEventListener("visibilitychange", follow);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", follow);
    };
  }, []);

  return view;
}

export function UpdateBanner() {
  const { t } = useTranslation();
  const view = useUpdateNotice();
  const [dismissed, setDismissed] = useState<number | null>(null);

  if (!view || view.at === dismissed) return null;
  return (
    <div className={styles.banner} role="status">
      <Icon name="alert" size={20} className={styles.icon} />
      <span className={styles.text}>
        {view.phase === "upcoming"
          ? t("updateNotice.upcoming", { time: view.time })
          : t("updateNotice.updating")}
      </span>
      <IconButton
        icon="close"
        label={t("common.close")}
        tip={false}
        diameter={36}
        iconSize={18}
        onClick={() => setDismissed(view.at)}
      />
    </div>
  );
}
