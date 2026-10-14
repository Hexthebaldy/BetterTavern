/** 三个标签页：故事、剧本、设置。标签栏自己画（components/bars.tsx 的 TabBar），每页自己画大标题。 */

import { Tabs } from "expo-router";

import { TabBar } from "../../src/components/ui.tsx";
import { usePalette } from "../../src/theme/index.ts";

export default function TabsLayout() {
  const palette = usePalette();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.bg } }}
    >
      <Tabs.Screen name="playthroughs" options={{ title: "故事" }} />
      <Tabs.Screen name="library" options={{ title: "剧本" }} />
      <Tabs.Screen name="settings" options={{ title: "设置" }} />
    </Tabs>
  );
}
