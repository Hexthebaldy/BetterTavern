/**
 * 设置里的页面怎么往下走一层、怎么返回。
 *
 * 设置子页（模型列表、模型详情、外部服务、账户、连接测试）的主体在 features/settings/screens/ 里，
 * 既能当路由页面（手机、中屏，app/settings/*.tsx 只是转一下），
 * 也能嵌进宽屏设置两栏的右栏（SettingsPane.tsx）。主体用 useSettingsNav() 跳转：
 * 路由页面里就是 router.push / router.back；嵌在右栏里时改成右栏自己的一个小栈，左栏不动。
 */

import { useRouter } from "expo-router";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { BackBar } from "../../components/ui.tsx";

export type SettingsTarget =
  | { screen: "models" }
  | { screen: "model"; id: string }
  | { screen: "tools" }
  | { screen: "account" }
  | { screen: "probe" }
  /** 添加模型：只在宽屏设置的右栏里单独打开（左栏“模型”的加号）；手机上添加表单在模型页里 */
  | { screen: "addModel" };

export type SettingsNav = {
  /** 往下走一层 */
  open: (target: SettingsTarget) => void;
  /** 回到上一层（删除模型之后之类） */
  back: () => void;
  /** 嵌在宽屏设置的右栏里：页面不画返回栏 */
  embedded: boolean;
};

const NavContext = createContext<SettingsNav | null>(null);

export function SettingsNavProvider({ value, children }: { value: SettingsNav; children: ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useSettingsNav(): SettingsNav {
  const router = useRouter();
  const inPane = useContext(NavContext);
  return useMemo<SettingsNav>(
    () =>
      inPane ?? {
        embedded: false,
        back: () => router.back(),
        open: (target) => {
          if (target.screen === "models" || target.screen === "addModel") router.push("/settings/models");
          else if (target.screen === "model")
            router.push({ pathname: "/settings/model/[id]", params: { id: target.id } });
          else if (target.screen === "tools") router.push("/settings/tools");
          else if (target.screen === "account") router.push("/settings/account");
          else router.push("/dev/probe");
        },
      },
    [inPane, router],
  );
}

/** 二级页左上角的返回按钮；嵌在右栏里时不画（右栏顶上有“‹ 上一层”） */
export function SettingsBack() {
  const nav = useSettingsNav();
  return nav.embedded ? null : <BackBar />;
}
