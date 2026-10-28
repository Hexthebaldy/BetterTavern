/** 编辑一个人设（id 为 new 是新建）。页面主体在 src/features/settings/screens/PersonaBody.tsx，宽屏设置两栏时它嵌在右栏里 */

import { useLocalSearchParams } from "expo-router";

import { PersonaBody } from "../../../src/features/settings/screens/PersonaBody.tsx";

export default function PersonaScreen() {
  const { id = "new" } = useLocalSearchParams<{ id: string }>();
  return <PersonaBody id={id} />;
}
