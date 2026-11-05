/**
 * 更新横幅：线上更新前 10 分钟开始显示（packages/core/src/notice/updateNotice.ts）。挂在根布局，所有页面都有；
 * 浮在页面顶部，不占布局。只在 App 处于前台时读，回到前台时马上读一次。关掉以后这一次更新不再显示。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  loadUpdateNotice,
  NOTICE_POLL_MS,
  noticeView,
  type UpdateNoticeView,
} from "@bettertavern/core/notice/updateNotice";

import { useApp } from "../state/AppProvider.tsx";
import { comicDepth, comicRadius, comicStroke, hardShadow, space, useComic } from "../theme/index.ts";
import { Icon } from "./icons.tsx";

function useUpdateNotice(serverUrl: string): UpdateNoticeView | null {
  const [view, setView] = useState<UpdateNoticeView | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = async (): Promise<void> => {
      const notice = await loadUpdateNotice(serverUrl, (url, init) => fetch(url, init));
      if (!stopped) setView(noticeView(notice, Date.now()));
    };
    const follow = (): void => {
      clearInterval(timer);
      if (AppState.currentState !== "active") return;
      void check();
      timer = setInterval(() => void check(), NOTICE_POLL_MS);
    };
    follow();
    const subscription = AppState.addEventListener("change", follow);
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [serverUrl]);

  return view;
}

export function UpdateBanner() {
  const { t } = useTranslation();
  const { serverUrl } = useApp();
  const c = useComic();
  const insets = useSafeAreaInsets();
  const view = useUpdateNotice(serverUrl);
  const [dismissed, setDismissed] = useState<number | null>(null);

  if (!view || view.at === dismissed) return null;
  return (
    <View pointerEvents="box-none" style={[styles.place, { top: insets.top + space.s }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.banner,
          {
            backgroundColor: c.paper,
            borderColor: c.ink,
            boxShadow: hardShadow(c.ink, comicDepth.raised),
          },
        ]}
      >
        <Icon name="alert" size={18} color={c.warn} />
        <Text style={[styles.text, { color: c.ink }]}>
          {view.phase === "upcoming"
            ? t("updateNotice.upcoming", { time: view.time })
            : t("updateNotice.updating")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          hitSlop={4}
          onPress={() => setDismissed(view.at)}
          style={styles.close}
        >
          <Icon name="close" size={18} color={c.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: "absolute", left: space.l, right: space.l, alignItems: "center" },
  banner: {
    maxWidth: 560,
    minHeight: 50,
    borderRadius: comicRadius.menu,
    borderWidth: comicStroke.frame,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingLeft: space.m,
    paddingRight: 4,
  },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
