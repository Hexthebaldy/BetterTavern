/**
 * 根布局：全局服务、界面文字的语言、界面偏好、主题、浮层、字体，按登录状态切换可访问的页面。
 * 字体加载完、界面偏好读出来之前保持系统启动画面（主题跟着偏好走，避免先闪一帧别的颜色）；
 * 之后恢复登录状态期间显示闪屏（app/index.tsx）。
 * 退出登录（包括令牌失效）时受保护的页面整体移出导航栈。
 * 所有页面自己画页头（components/bars.tsx），原生导航栏不显示；返回手势照常可用。
 */

import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, type Theme } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { i18n } from "@bettertavern/core/i18n/index";

import { OverlayProvider } from "../src/components/ui.tsx";
import { installDiagnostics } from "../src/observability/setup.ts";
import { AppProvider, useApp } from "../src/state/AppProvider.tsx";
import { PrefsProvider, usePrefs } from "../src/state/PrefsProvider.tsx";
import { font, ThemeProvider as AppThemeProvider, useComic, useIsDark } from "../src/theme/index.ts";
import { lockPhonesToPortrait } from "../src/utils/orientation.ts";

void SplashScreen.preventAutoHideAsync();
// 诊断日志（手机上的小本子）尽早装好，启动阶段的错误也能记下来
installDiagnostics();
lockPhonesToPortrait();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [font.mono]: IBMPlexMono_400Regular,
    [font.monoMedium]: IBMPlexMono_500Medium,
    // 正文宋体中文、日文各一份，启动时一起加载（都是本地文件）；按需加载会在第一次打开日文故事时先闪一帧系统字体
    [font.serif]: require("../assets/fonts/NotoSerifSC-Regular.ttf"),
    [font.serifJa]: require("../assets/fonts/NotoSerifJP-Regular.ttf"),
  });
  const ready = fontsLoaded || fontError !== null;

  if (!ready) return null;
  return (
    <I18nextProvider i18n={i18n}>
      <AppProvider>
        <PrefsProvider>
          <Themed>
            <OverlayProvider>
              <RootNavigator />
            </OverlayProvider>
          </Themed>
        </PrefsProvider>
      </AppProvider>
    </I18nextProvider>
  );
}

/** 按外观设置套上主题；偏好读出来之前不画，系统启动画面一直挡着 */
function Themed({ children }: { children: ReactNode }) {
  const { theme, loaded } = usePrefs();

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;
  return <AppThemeProvider setting={theme}>{children}</AppThemeProvider>;
}

function RootNavigator() {
  const { status } = useApp();
  const c = useComic();
  const dark = useIsDark();

  const theme = useMemo<Theme>(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.ink,
        // 页面底色：切页、转场时不闪白
        background: c.page,
        card: c.page,
        text: c.ink,
        border: c.ink,
      },
    };
  }, [dark, c]);

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="scenario/[id]/index" />
          <Stack.Screen name="scenario/form" />
          <Stack.Screen name="card/[id]" />
          <Stack.Screen name="workbench/[id]" />
          <Stack.Screen name="play/[id]/index" />
          <Stack.Screen name="settings/models" />
          <Stack.Screen name="settings/tools" />
          <Stack.Screen name="settings/personas" />
          <Stack.Screen name="settings/persona/[id]" />
          <Stack.Screen name="settings/model/[id]" />
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
