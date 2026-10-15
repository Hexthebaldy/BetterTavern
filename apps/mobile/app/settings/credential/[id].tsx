/** 一个密钥的详情。页面主体在 src/features/settings/screens/CredentialBody.tsx，宽屏设置两栏时它嵌在右栏里 */

import { useLocalSearchParams } from "expo-router";

import { CredentialBody } from "../../../src/features/settings/screens/CredentialBody.tsx";

export default function CredentialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CredentialBody id={id} />;
}
