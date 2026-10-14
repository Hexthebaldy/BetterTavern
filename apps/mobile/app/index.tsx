/** 入口：按登录状态跳到故事列表或登录页 */

import { Redirect } from "expo-router";

import { useApp } from "../src/state/AppProvider.tsx";

export default function Index() {
  const { status } = useApp();
  if (status === "restoring") return null; // 启动画面还盖着
  return <Redirect href={status === "signedIn" ? "/playthroughs" : "/login"} />;
}
