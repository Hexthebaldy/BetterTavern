/** 连接测试。页面主体在 src/features/probe/ProbeBody.tsx，宽屏设置两栏时它嵌在右栏里 */

import { useLocalSearchParams } from "expo-router";

import { ProbeBody } from "../../src/features/probe/ProbeBody.tsx";

export default function ProbeScreen() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  return <ProbeBody url={url} />;
}
