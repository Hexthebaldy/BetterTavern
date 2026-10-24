/**
 * 按下的效果（docs/design/comic/mobile/README.md 的“按下”）：往投影的方向挪、投影缩短，松手弹回；
 * 不缩放、不改透明度。投影 4 时挪 3、剩 1（@bettertavern/design 的 pressedShift）。
 * 带投影的按钮、选项、格子都用它，写在 Pressable 的 style 回调里：
 *
 *   style={({ pressed }) => [styles.box, press(pressed, comicDepth.raised, c.ink)]}
 *
 * 没有投影的东西（列表行、菜单项）按下时换底色，不用它。
 */

import type { ViewStyle } from "react-native";

import { hardShadow, pressedShift } from "@bettertavern/design/comic";

export function press(down: boolean, depth: number, color: string): ViewStyle {
  const now = down ? pressedShift(depth) : { shift: 0, depth };
  return {
    boxShadow: hardShadow(color, now.depth),
    transform: [{ translateX: now.shift }, { translateY: now.shift }],
  };
}
