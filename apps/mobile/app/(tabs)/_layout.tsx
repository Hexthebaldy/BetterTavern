/**
 * 四个标签页：存档、库、工作台、设置。标签栏自己画（components/tabBar.tsx 的 TabBar），每页自己画大标题。
 * 切换标签时新页面淡入（components/TabScene.tsx，JS 驱动）；导航自带的淡入淡出关掉，它由原生驱动透明度，
 * 偶尔和 React 记的值对不上，切过去的页面整页白屏。
 */

import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { TabBar, TabScene } from "../../src/components/ui.tsx";
import { useComic } from "../../src/theme/index.ts";

export default function TabsLayout() {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenLayout={({ children }) => <TabScene>{children}</TabScene>}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.page },
        animation: "none",
      }}
    >
      <Tabs.Screen name="playthroughs" options={{ title: t("nav.saves") }} />
      <Tabs.Screen name="library" options={{ title: t("nav.library") }} />
      <Tabs.Screen name="workbench" options={{ title: t("nav.workbench") }} />
      <Tabs.Screen name="settings" options={{ title: t("nav.settings") }} />
    </Tabs>
  );
}
