/**
 * 根布局：全局服务、主题、按登录状态切换可访问的页面。
 * 恢复登录状态期间保持启动画面；退出登录（包括令牌失效）时受保护的页面整体移出导航栈。
 */

import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";

import { AppProvider, useApp } from "../src/state/AppProvider.tsx";
import { useIsDark, usePalette } from "../src/theme/index.ts";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AppProvider>
      <RootNavigator />
    </AppProvider>
  );
}

function RootNavigator() {
  const { status } = useApp();
  const palette = usePalette();
  const dark = useIsDark();

  useEffect(() => {
    if (status !== "restoring") void SplashScreen.hideAsync();
  }, [status]);

  const theme = useMemo<Theme>(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.accent,
        background: palette.paper,
        card: palette.paper,
        text: palette.ink,
        border: palette.rule,
      },
    };
  }, [dark, palette]);

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: palette.paper },
          headerTintColor: palette.accent,
          headerTitleStyle: { color: palette.ink },
          contentStyle: { backgroundColor: palette.paper },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="scenario/[id]" options={{ title: "" }} />
          <Stack.Screen name="play/[id]/index" options={{ title: "" }} />
          <Stack.Screen name="settings/credentials" options={{ title: "密钥与端点" }} />
          <Stack.Screen name="settings/credential/[id]" options={{ title: "" }} />
          <Stack.Screen name="settings/routes" options={{ title: "导演模型" }} />
          <Stack.Screen name="settings/account" options={{ title: "账户" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="dev/probe" options={{ title: "连接测试" }} />
      </Stack>
    </ThemeProvider>
  );
}
