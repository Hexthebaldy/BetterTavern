/**
 * 三个标签页：故事、剧本、设置。标签栏自己画（components/bars.tsx 的 TabBar），每页自己画大标题。
 * 切换标签时页面交叉淡入淡出，和标签栏胶囊的动画同时长。
 */

import { Tabs } from "expo-router";
import { Easing } from "react-native";

import { TAB_FADE_MS, TabBar } from "../../src/components/ui.tsx";
import { usePalette } from "../../src/theme/index.ts";

export default function TabsLayout() {
  const palette = usePalette();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.bg },
        animation: "fade",
        transitionSpec: {
          animation: "timing",
          config: { duration: TAB_FADE_MS, easing: Easing.out(Easing.cubic) },
        },
      }}
    >
      <Tabs.Screen name="playthroughs" options={{ title: "存档" }} />
      <Tabs.Screen name="library" options={{ title: "剧本" }} />
      <Tabs.Screen name="settings" options={{ title: "设置" }} />
    </Tabs>
  );
}
