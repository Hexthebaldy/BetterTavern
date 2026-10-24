/**
 * 网点底（docs/design/comic）：蓝底白点、白底墨点、灰底墨点，和网页的 --ht-acc、--ht-ink、--ht-grey 一样。
 * 用 react-native-svg 的图案铺满整块，children 盖在上面。点的大小和颜色在 @bettertavern/design 的 comic.ts。
 */

import { useId, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

import { halftone, type HalftoneTone } from "@bettertavern/design/comic";

import { useComic, useTheme } from "../theme/index.ts";

export function Halftone({
  tone,
  style,
  children,
}: {
  tone: HalftoneTone;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const c = useComic();
  const theme = useTheme();
  const id = `ht${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dots = halftone(tone, theme.id);
  const bg = tone === "acc" ? c.acc : tone === "ink" ? c.paper : c.grey;
  return (
    <View style={[{ backgroundColor: bg, overflow: "hidden" }, style]}>
      <Svg style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
        <Defs>
          <Pattern id={id} width={dots.step} height={dots.step} patternUnits="userSpaceOnUse">
            <Circle cx={dots.step / 2} cy={dots.step / 2} r={dots.radius} fill={dots.dot} />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
