/**
 * 根布局：全局服务、界面偏好、浮层、字体、主题，按登录状态切换可访问的页面。
 * 字体加载完之前保持系统启动画面；之后恢复登录状态期间显示闪屏（app/index.tsx）。
 * 退出登录（包括令牌失效）时受保护的页面整体移出导航栈。
 * 所有页面自己画页头（components/bars.tsx），原生导航栏不显示；返回手势照常可用。
 */

import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, type Theme } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";

import { OverlayProvider } from "../src/components/ui.tsx";
import { AppProvider, useApp } from "../src/state/AppProvider.tsx";
import { PrefsProvider } from "../src/state/PrefsProvider.tsx";
import { font, useIsDark, usePalette } from "../src/theme/index.ts";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [font.mono]: IBMPlexMono_400Regular,
    [font.monoMedium]: IBMPlexMono_500Medium,
    [font.serif]: require("../assets/fonts/NotoSerifSC-Regular.ttf"),
  });
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <AppProvider>
      <PrefsProvider>
        <OverlayProvider>
          <RootNavigator />
        </OverlayProvider>
      </PrefsProvider>
    </AppProvider>
  );
}

function RootNavigator() {
  const { status } = useApp();
  const palette = usePalette();
  const dark = useIsDark();

  const theme = useMemo<Theme>(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.ink,
        background: palette.bg,
        card: palette.bg,
        text: palette.ink,
        border: palette.line,
      },
    };
  }, [dark, palette]);

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="scenario/[id]" />
          <Stack.Screen name="play/[id]/index" />
          <Stack.Screen name="settings/credentials" />
          <Stack.Screen name="settings/credential/[id]" />
          <Stack.Screen name="settings/routes" />
          <Stack.Screen name="settings/account" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="dev/probe" />
      </Stack>
    </ThemeProvider>
  );
}
