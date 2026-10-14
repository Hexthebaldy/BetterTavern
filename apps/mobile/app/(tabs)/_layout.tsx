/** 三个标签页：故事、剧本、设置。标签只用文字。 */

import { Tabs } from "expo-router";

import { type, usePalette } from "../../src/theme/index.ts";

export default function TabsLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.paper },
        headerShadowVisible: false,
        headerTitleStyle: { color: palette.ink },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: { backgroundColor: palette.paper, borderTopColor: palette.rule },
        tabBarLabelStyle: { fontSize: type.body.fontSize, fontWeight: "600" },
        tabBarLabelPosition: "beside-icon",
        tabBarIcon: () => null,
        sceneStyle: { backgroundColor: palette.paper },
      }}
    >
      <Tabs.Screen name="playthroughs" options={{ title: "故事" }} />
      <Tabs.Screen name="library" options={{ title: "剧本" }} />
      <Tabs.Screen name="settings" options={{ title: "设置" }} />
    </Tabs>
  );
}
