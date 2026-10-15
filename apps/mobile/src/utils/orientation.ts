/**
 * 手机锁竖屏，平板支持所有方向（iPad 要参与分屏和台前调度，就必须支持所有方向）。
 * app.config.ts 里 orientation 是 default（不锁），iOS 另外用 Info.plist 只给 iPhone 竖屏；
 * 这里在启动时按屏幕短边再锁一次，管住 Android 手机和 Expo Go。看的是整块屏幕，不是窗口：分屏时窗口窄，设备仍是平板。
 */

import * as ScreenOrientation from "expo-screen-orientation";
import { Dimensions } from "react-native";

import { locksPortrait } from "../theme/layout.ts";

export function lockPhonesToPortrait(): void {
  if (!locksPortrait(Dimensions.get("screen"))) return;
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}
