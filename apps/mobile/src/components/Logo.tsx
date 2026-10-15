/**
 * 标志“错版”：几何在 @bettertavern/design 的 logo.ts（和网页端共用），这里用 react-native-svg 画出来。
 * 线条用 ink、内核用 acc，深色模式自动反白。
 */

import Svg, { G, Path } from "react-native-svg";

import { LOGO, logoStrokeScale } from "@bettertavern/design/logo";

import { usePalette } from "../theme/index.ts";

export function Logo({ size = 48 }: { size?: number }) {
  const palette = usePalette();
  const m = logoStrokeScale(size);
  return (
    <Svg width={size} height={size} viewBox={LOGO.viewBox} accessibilityLabel="BetterTavern">
      <G fill="none" stroke={palette.ink} strokeLinejoin="miter" strokeMiterlimit={4}>
        <Path d={LOGO.frameA} strokeWidth={LOGO.frameStroke * m} />
        <Path d={LOGO.frameB} strokeWidth={LOGO.frameStroke * m} />
        <Path d={LOGO.inner} strokeWidth={LOGO.innerStroke * m} />
      </G>
      <Path d={LOGO.core} fill={palette.acc} />
    </Svg>
  );
}
