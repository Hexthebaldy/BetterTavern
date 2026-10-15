/**
 * 当前窗口的布局档位（窄 / 中 / 宽），只看 useWindowDimensions().width：旋转、分屏拖动时跟着变，
 * 页面据此换布局，组件不卸载，草稿、滚动位置这些状态都留着。断点和栏宽见 theme/layout.ts。
 */

import { useWindowDimensions } from "react-native";

import { sizeClass, type SizeClass } from "../theme/layout.ts";

export type Layout = {
  width: number;
  height: number;
  size: SizeClass;
  /** 手机布局（< 600） */
  compact: boolean;
  /** 宽屏（≥ 900）：左侧导航栏、两栏页面 */
  expanded: boolean;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const size = sizeClass(width);
  return { width, height, size, compact: size === "compact", expanded: size === "expanded" };
}
