/**
 * 阅读主屏：导航栏（返回、标题）、故事流、底部固定的操作栏。离开页面只断开连接，服务端的生成继续，回来时会接上。
 * - 选项接在最新一段后面（TurnActions.tsx），跟着正文滚动，不挡正文；
 * - 操作栏（BottomBar.tsx）左边“世界”，右边“更多”，中间是“自己写…”、生成中的状态和“停止”，
 *   或者往上翻时的“回到最新”。量出它的高度，故事流的底部按它留白。
 * 输入框的开关、草稿、是否离开了最新位置都放在这一页，旋转、分屏时都不会丢；草稿每个故事一份存在手机上（useDraft）。
 * 自己写的行动没能变成回合（失败后换个行动、故事在别处被推进）时，文字回到输入框并展开。
 *
 * 平板（theme/layout.ts）：正文收进最宽 640 的阅读栏，操作栏的内容宽 672、同一条中线；
 * 世界状态在阅读页宽 ≥ 1100 时停靠在右侧，阅读栏和操作栏在剩下的宽度里居中，世界按钮显示为选中，
 * 再点一次收起；停靠的开关存在界面偏好里，打开任意故事都保持。更窄时从右侧滑出，手机上是底部面板。
 * 旋转、分屏改变宽度时只换布局：故事流、操作栏都不卸载，滚动位置和草稿都还在；停靠着的面板变窄后换成滑出的。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeError, describeTurnError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { canAct, headTurn, isEnded, withReturnedText } from "@bettertavern/core/play/turnMachine";
import { pane, readingWidth, worldPresentation } from "@bettertavern/design/layout";

import { Button, Dots, Icon, NavBar, SkeletonLine, useOverlay } from "../../../src/components/ui.tsx";
import { BottomBar } from "../../../src/features/play/BottomBar.tsx";
import { MoreSheet } from "../../../src/features/play/MoreSheet.tsx";
import {
  BookHeader,
  columnWidth,
  StoryFeed,
  type StoryFeedHandle,
} from "../../../src/features/play/StoryFeed.tsx";
import { TurnActions } from "../../../src/features/play/TurnActions.tsx";
import { useDraft } from "../../../src/features/play/useDraft.ts";
import { usePlaySession } from "../../../src/features/play/usePlaySession.ts";
import { WorldDock, WorldSheet } from "../../../src/features/play/WorldSheet.tsx";
import { useLayout } from "../../../src/hooks/useLayout.ts";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { usePrefs } from "../../../src/state/PrefsProvider.tsx";
import { radius, space, usePalette } from "../../../src/theme/index.ts";

function OpeningSkeleton() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={styles.skeleton}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine width="58%" />
        <View style={[styles.skeletonCard, { backgroundColor: palette.bg2 }]} />
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine width="74%" />
        <View style={{ height: space.m }} />
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine width="40%" />
      </View>
      <View
        style={[styles.opening, { bottom: insets.bottom + 30, backgroundColor: palette.bg2 }]}
        accessibilityRole="progressbar"
        accessibilityLabel={t("play.opening")}
      >
        <Dots />
        <Text style={{ fontSize: 13, color: palette.mut }}>{t("play.opening")}</Text>
      </View>
    </View>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <View style={styles.failedWrap}>
      <View style={[styles.failed, { backgroundColor: palette.bg2 }]} accessibilityRole="alert">
        <View style={[styles.failedIcon, { backgroundColor: palette.errBg }]}>
          <Icon name="alertCircle" size={28} color={palette.err} />
        </View>
        <Text
          style={{ fontSize: 22, lineHeight: 30, fontWeight: "700", color: palette.ink, textAlign: "center" }}
        >
          {t("play.openFailed")}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 24, color: palette.mut, textAlign: "center" }}>
          {message}
        </Text>
        <Button label={t("common.reload")} icon="retry" onPress={onRetry} style={styles.failedButton} />
      </View>
    </View>
  );
}

export default function PlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { api } = useApp();
  const { t } = useTranslation();
  const { reading, worldDocked, setWorldDocked } = usePrefs();
  const { width } = useLayout();
  const controls = usePlaySession(id);
  const { state } = controls;
  const [title, setTitle] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const worldMode = worldPresentation(width);
  // 停靠模式下开关跟着界面偏好（所有故事共用）；滑出和底部面板只在这一页里开关
  const [worldOpen, setWorldOpen] = useState(() => worldMode === "dock" && worldDocked);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<View>(null);
  const feed = useRef<StoryFeedHandle>(null);
  // 自己写：输入框展开着没有、草稿
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useDraft(id);
  // 往上翻离开了最新位置：操作栏中间换成“回到最新”
  const [away, setAway] = useState(false);
  // 操作栏盖住的高度（展开时连同键盘）：故事流在它上方结束
  const [bar, setBar] = useState(80);
  const onBarHeight = useCallback((h: number) => setBar((old) => (Math.abs(old - h) < 1 ? old : h)), []);

  // 变宽到可以停靠时，偏好里是开着的就展开；变窄时开着的停靠面板换成滑出面板（worldOpen 不变）
  const lastMode = useRef(worldMode);
  useEffect(() => {
    if (lastMode.current !== "dock" && worldMode === "dock" && worldDocked) setWorldOpen(true);
    lastMode.current = worldMode;
  }, [worldMode, worldDocked]);

  const docked = worldMode === "dock" && worldOpen;
  const toggleWorld = (): void => {
    if (worldMode === "dock") {
      setWorldOpen(!worldOpen);
      setWorldDocked(!worldOpen);
    } else {
      setWorldOpen(true);
    }
  };
  const closeWorld = (): void => {
    setWorldOpen(false);
    if (worldMode === "dock") setWorldDocked(false);
  };
  // 阅读区：停靠时让出右边的世界状态面板
  const available = readingWidth(width, docked);

  // 剧本名和封面图片（剧本删掉了也不影响阅读）
  useEffect(() => {
    if (!state.scenarioId) return;
    let alive = true;
    api.scenarios
      .get(state.scenarioId)
      .then((s) => {
        if (alive) setScenario(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, state.scenarioId]);

  // 读屏：一段写完后整段朗读，不逐字播报
  const announced = useRef<string | null>(null);
  const head = headTurn(state);
  useEffect(() => {
    if (!head || state.phase !== "idle") return;
    if (announced.current === null) {
      announced.current = head.id; // 打开页面时已有的内容不朗读
      return;
    }
    if (announced.current === head.id) return;
    announced.current = head.id;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (on) AccessibilityInfo.announceForAccessibility(head.narrative);
    });
  }, [head, state.phase]);

  // 自己写的行动被退回来：放回输入框（已有草稿时放在前面）并展开；故事在别处被推进时再提示一句
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const { takeReturned } = controls;
  useEffect(() => {
    if (!state.returned) return;
    const returned = takeReturned();
    if (!returned) return;
    setDraft(withReturnedText(draftNow.current, returned.text));
    setWriting(true);
    if (returned.why === "stale") overlay.toast(t("play.actionReturned"));
  }, [state.returned, takeReturned, setDraft, overlay, t]);

  const shownTitle = title ?? state.title;

  const rename = async (): Promise<void> => {
    setMoreOpen(false);
    const next = await overlay.prompt({
      title: t("stories.renameTitle"),
      label: t("stories.nameLabel"),
      initial: shownTitle,
      maxLength: 80,
    });
    if (!next || next === shownTitle) return;
    try {
      const updated = await api.playthroughs.rename(id, next);
      setTitle(updated.title);
    } catch (e) {
      overlay.toast(t("common.renameFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  // 写结局：确认框里可以填想要的方向，也可以不填；写完就不能再继续，也没有撤销
  const end = async (): Promise<void> => {
    setMoreOpen(false);
    const wish = await overlay.prompt({
      title: t("play.endTitle"),
      message: t("play.endMessage"),
      label: t("play.endWish"),
      placeholder: t("play.endWishPlaceholder"),
      maxLength: 2000,
      confirmLabel: t("play.writeEnding"),
      optional: true,
      multiline: true,
    });
    if (wish === null) return;
    controls.submit({ source: "ending", text: wish });
    feed.current?.jumpToLatest();
  };

  const remove = async (): Promise<void> => {
    setMoreOpen(false);
    const ok = await overlay.confirm({
      title: t("common.deleteConfirm", { name: shownTitle }),
      message: t("stories.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.playthroughs.remove(id);
      overlay.toast(t("common.deleted", { name: shownTitle }));
      router.back();
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const nav = <NavBar title={shownTitle} />;

  if (state.phase === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {nav}
        <OpeningSkeleton />
      </View>
    );
  }
  if (state.phase === "load_failed") {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {nav}
        <LoadFailed
          message={state.error ? describeTurnError(state.error) : t("play.loadFailed")}
          onRetry={controls.reload}
        />
      </View>
    );
  }
  const syncing = state.phase === "syncing";
  const send = (text: string): void => {
    setWriting(false);
    setDraft("");
    controls.submit({ source: "text", text });
  };
  return (
    // 左边是阅读区（导航栏、故事流、操作栏），停靠时右边是世界状态；手机上只有阅读区
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: palette.bg }}>
      <View style={{ flex: 1 }}>
        {nav}
        {/* 操作栏自己跟着键盘浮起（见 BottomBar），故事流的底部留白跟着它走 */}
        <View style={{ flex: 1 }}>
          <StoryFeed
            ref={feed}
            state={state}
            reading={reading}
            dimmed={syncing}
            bottomInset={bar}
            available={available}
            onAwayChange={setAway}
            footer={
              <TurnActions
                state={state}
                controls={controls}
                onOpenSettings={() => router.push("/settings/models")}
                onPicked={() => setWriting(false)}
                available={available}
              />
            }
            header={
              <BookHeader
                seed={state.scenarioId ?? id}
                blobId={scenario?.avatar_blob_id ?? null}
                title={shownTitle}
                card={scenario?.name ?? null}
                protagonist={state.protagonist}
                width={columnWidth(available)}
              />
            }
          />
          {syncing ? (
            <View accessibilityRole="alert" style={[styles.syncing, { backgroundColor: palette.accBg }]}>
              <Icon name="retry" size={16} color={palette.acc} />
              <Text style={{ fontSize: 13.5, fontWeight: "500", color: palette.acc }}>
                {t("play.syncing")}
              </Text>
            </View>
          ) : null}
          <BottomBar
            state={state}
            controls={controls}
            writing={writing}
            onWrite={() => {
              // 失败后点“自己写…”等于“换个行动”：自己写的那段会退回输入框
              if (state.phase === "failed") controls.dismissError();
              setWriting(true);
            }}
            onCloseWrite={() => setWriting(false)}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            away={away}
            onJumpToLatest={() => feed.current?.jumpToLatest()}
            onOpenWorld={toggleWorld}
            onOpenMore={() => setMoreOpen(true)}
            worldActive={docked}
            moreActive={moreOpen}
            moreRef={moreButton}
            onHeight={onBarHeight}
            available={available}
          />
        </View>
      </View>
      {docked ? <WorldDock onClose={closeWorld} playthroughId={id} /> : null}
      <WorldSheet visible={worldOpen && worldMode !== "dock"} onClose={closeWorld} playthroughId={id} />
      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchor={moreButton}
        onRename={() => void rename()}
        onWorld={() => {
          setMoreOpen(false);
          // 停靠时世界状态是页面的一部分，直接展开；否则打开世界状态面板，
          // 它会等“更多”面板被 iOS 收回再挂上（useGatedModal）
          if (worldMode === "dock") toggleWorld();
          else setWorldOpen(true);
        }}
        onEnd={() => void end()}
        ending={isEnded(state) ? "ended" : canAct(state) ? "ready" : "busy"}
        onDelete={() => void remove()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    width: "100%",
    maxWidth: pane.readable + space.read * 2,
    alignSelf: "center",
    paddingHorizontal: space.read,
    paddingTop: space.xl,
    gap: 19,
  },
  skeletonCard: {
    height: 56,
    borderRadius: radius.card,
    marginHorizontal: -space.s,
    marginVertical: space.m,
  },
  opening: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 36,
    paddingHorizontal: space.l,
    borderRadius: 18,
  },
  /** 平板上卡片最宽 480，居中；手机上就是整宽 */
  failedWrap: { width: "100%", maxWidth: pane.dialog + space.l * 2, alignSelf: "center" },
  failed: {
    marginTop: 146,
    marginHorizontal: space.l,
    paddingTop: space.xl,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderRadius: radius.sheet,
    alignItems: "center",
    gap: space.m,
  },
  failedIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  failedButton: { alignSelf: "stretch", marginTop: space.s },
  syncing: {
    position: "absolute",
    top: space.s,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 40,
    paddingLeft: space.m,
    paddingRight: space.l,
    borderRadius: 20,
  },
});
