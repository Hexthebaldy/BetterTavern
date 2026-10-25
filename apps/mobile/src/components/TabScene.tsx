/**
 * 标签页的淡入（app/(tabs)/_layout.tsx 经 screenLayout 给四个标签页都包一层）。
 *
 * 导航自带的淡入淡出（animation: "fade"）由原生驱动透明度，偶尔和 React 记的值对不上，切过去的页面停在透明度 0，
 * 整页白屏，要再切一次才回来（英文界面下更容易出现）。所以关掉导航自带的动画，改成这里：
 * 页面获得焦点时透明度从 0 拉到 1，由 JS 一帧帧写，React 记的值和屏幕上的始终一致；
 * 旧页面不做淡出，切换时立刻下去。中途又切走就停下，下次获得焦点重新从 0 开始。
 */

import { useIsFocused } from "expo-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

import { TAB_FADE_MS } from "./bars.tsx";

export function TabScene({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!focused) return;
    opacity.setValue(0);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: TAB_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    fade.start();
    return () => fade.stop();
  }, [focused, opacity]);

  return <Animated.View style={[styles.scene, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
});
