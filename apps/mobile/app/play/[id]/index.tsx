/**
 * 阅读主屏：导航栏（返回、世界状态、更多）、故事流、底部行动栏。
 * 顶部只放低频入口，所有回合操作都在屏幕下三分之一；离开页面只断开连接，服务端的生成继续，回来时会接上。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { describeError } from "../../../src/api/client.ts";
import type { Scenario } from "../../../src/api/types.ts";
import { Button, Dots, Icon, NavBar, SkeletonLine, useOverlay } from "../../../src/components/ui.tsx";
import { ActionBar } from "../../../src/features/play/ActionBar.tsx";
import { MoreSheet } from "../../../src/features/play/MoreSheet.tsx";
import { BookHeader, StoryFeed } from "../../../src/features/play/StoryFeed.tsx";
import { headTurn } from "../../../src/features/play/turnMachine.ts";
import { usePlaySession } from "../../../src/features/play/usePlaySession.ts";
import { WorldSheet } from "../../../src/features/play/WorldSheet.tsx";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { usePrefs } from "../../../src/state/PrefsProvider.tsx";
import { font, space, usePalette } from "../../../src/theme/index.ts";

function OpeningSkeleton() {
  const palette = usePalette();
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
        <View style={{ height: 16 }} />
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine width="74%" />
        <View
          style={{
            height: 52,
            backgroundColor: palette.bg2,
            marginHorizontal: -space.read,
            marginVertical: space.l,
          }}
        />
        <SkeletonLine />
        <SkeletonLine width="40%" />
      </View>
      <View style={styles.opening} accessibilityRole="progressbar" accessibilityLabel="正在打开故事">
        <Dots />
        <Text style={[styles.mono, { color: palette.mut }]}>正在打开故事</Text>
      </View>
    </View>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const palette = usePalette();
  return (
    <View style={styles.failed} accessibilityRole="alert">
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Rect
          x={0.75}
          y={0.75}
          width={54.5}
          height={54.5}
          fill="none"
          stroke={palette.err}
          strokeWidth={1.5}
        />
        <Path d="M18 18l20 20M38 18L18 38" stroke={palette.err} strokeWidth={1.5} />
      </Svg>
      <Text style={{ fontSize: 24, lineHeight: 32, fontWeight: "700", color: palette.ink }}>
        故事没能打开
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 24, color: palette.mut }}>{message}</Text>
      <Button
        label="重新加载"
        variant="secondary"
        trailingIcon="retry"
        between
        onPress={onRetry}
        style={{ marginTop: space.s }}
      />
    </View>
  );
}

export default function PlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { api } = useApp();
  const { reading } = usePrefs();
  const { width } = useWindowDimensions();
  const controls = usePlaySession(id);
  const { state } = controls;
  const [title, setTitle] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [worldOpen, setWorldOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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

  const shownTitle = title ?? state.title;

  const rename = async (): Promise<void> => {
    setMoreOpen(false);
    const next = await overlay.prompt({
      title: "重命名故事",
      label: "故事标题",
      initial: shownTitle,
      maxLength: 80,
    });
    if (!next || next === shownTitle) return;
    try {
      const updated = await api.playthroughs.rename(id, next);
      setTitle(updated.title);
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const remove = async (): Promise<void> => {
    setMoreOpen(false);
    const ok = await overlay.confirm({
      title: `删除“${shownTitle}”？`,
      message: "删除后故事和世界状态都无法恢复。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.playthroughs.remove(id);
      overlay.toast(`已删除“${shownTitle}”`);
      router.back();
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const loaded = state.phase !== "loading" && state.phase !== "load_failed";
  const nav = (
    <NavBar
      title={shownTitle}
      actions={
        loaded
          ? [
              { icon: "world", label: "世界状态", onPress: () => setWorldOpen(true) },
              { icon: "more", label: "更多", onPress: () => setMoreOpen(true) },
            ]
          : []
      }
    />
  );

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
        <LoadFailed message={state.error?.message ?? "加载失败"} onRetry={controls.reload} />
      </View>
    );
  }
  const syncing = state.phase === "syncing";
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      {nav}
      {syncing ? (
        <View
          accessibilityRole="alert"
          style={[styles.syncing, { backgroundColor: palette.accBg, borderBottomColor: palette.acc }]}
        >
          <Icon name="sync" size={18} color={palette.acc} />
          <Text style={{ fontSize: 13, fontWeight: "500", color: palette.acc }}>故事有更新，正在同步…</Text>
        </View>
      ) : null}
      <StoryFeed
        state={state}
        reading={reading}
        dimmed={syncing}
        header={
          <BookHeader
            seed={state.scenarioId ?? id}
            blobId={scenario?.avatar_blob_id ?? null}
            title={shownTitle}
            card={scenario?.name ?? null}
            protagonist={state.protagonist}
            width={width}
          />
        }
      />
      <ActionBar state={state} controls={controls} onOpenSettings={() => router.push("/settings/routes")} />
      <WorldSheet visible={worldOpen} onClose={() => setWorldOpen(false)} playthroughId={id} />
      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onRename={() => void rename()}
        onWorld={() => {
          setMoreOpen(false);
          setTimeout(() => setWorldOpen(true), 260);
        }}
        onDelete={() => void remove()}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  skeleton: { paddingHorizontal: space.read, paddingTop: 32, gap: 19 },
  opening: {
    position: "absolute",
    left: space.read,
    bottom: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
  },
  mono: { fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.7 },
  failed: { paddingHorizontal: space.read, paddingTop: 180, gap: space.l },
  syncing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
});
