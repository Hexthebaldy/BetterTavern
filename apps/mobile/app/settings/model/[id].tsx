/** 一个模型的详情。页面主体在 src/features/settings/screens/ModelBody.tsx，宽屏设置两栏时它嵌在右栏里 */

import { useLocalSearchParams } from "expo-router";

import { ModelBody } from "../../../src/features/settings/screens/ModelBody.tsx";

export default function ModelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ModelBody id={id} />;
}
