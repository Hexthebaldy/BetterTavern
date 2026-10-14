/**
 * 阅读主屏：故事流、两个选项、自由输入；生成中可以停止，失败可以重试。
 * 离开页面只断开连接，服务端的生成继续，回来时会接上。
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Centered, Loading } from "../../../src/components/ui.tsx";
import { ActionBar } from "../../../src/features/play/ActionBar.tsx";
import { StoryFeed } from "../../../src/features/play/StoryFeed.tsx";
import { headTurn } from "../../../src/features/play/turnMachine.ts";
import { usePlaySession } from "../../../src/features/play/usePlaySession.ts";
import { space, usePalette } from "../../../src/theme/index.ts";

export default function PlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const controls = usePlaySession(id);
  const { state } = controls;

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

  const title = <Stack.Screen options={{ title: state.title }} />;

  if (state.phase === "loading") {
    return (
      <>
        {title}
        <Loading />
      </>
    );
  }
  if (state.phase === "load_failed") {
    return (
      <>
        {title}
        <Centered>
          <Body style={{ marginBottom: space.l, textAlign: "center" }}>
            {state.error?.message ?? "加载失败"}
          </Body>
          <Button label="重新加载" onPress={controls.reload} />
        </Centered>
      </>
    );
  }
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1, backgroundColor: palette.paper }}
    >
      {title}
      {state.phase === "syncing" ? <Loading label="故事有更新，正在同步…" /> : <StoryFeed state={state} />}
      <View style={{ paddingBottom: insets.bottom }}>
        <ActionBar state={state} controls={controls} onOpenSettings={() => router.push("/settings/routes")} />
      </View>
    </KeyboardAvoidingView>
  );
}
