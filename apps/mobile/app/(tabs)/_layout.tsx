/**
 * 四个标签页：存档、剧本、工作台、设置。标签栏自己画（components/bars.tsx 的 TabBar），每页自己画大标题。
 * 切换标签时页面交叉淡入淡出，和标签栏胶囊的动画同时长。
 */

import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Easing } from "react-native";

import { TAB_FADE_MS, TabBar } from "../../src/components/ui.tsx";
import { useComic } from "../../src/theme/index.ts";

export default function TabsLayout() {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.page },
        animation: "fade",
        transitionSpec: {
          animation: "timing",
          config: { duration: TAB_FADE_MS, easing: Easing.out(Easing.cubic) },
        },
      }}
    >
      <Tabs.Screen name="playthroughs" options={{ title: t("nav.saves") }} />
      <Tabs.Screen name="library" options={{ title: t("nav.library") }} />
      <Tabs.Screen name="workbench" options={{ title: t("nav.workbench") }} />
      <Tabs.Screen name="settings" options={{ title: t("nav.settings") }} />
    </Tabs>
  );
}
