/** 标志：墨色圆角方块里一个反白的 R，右上角一个蓝色圆点 */

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { usePalette } from "../theme/index.ts";

export function Logo({ size = 48 }: { size?: number }) {
  const palette = usePalette();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="BetterTavern">
      <Rect width={32} height={32} rx={10} fill={palette.ink} />
      <Path
        d="M10 23V9h6.5a4.5 4.5 0 010 9H10M16.5 18l6 5"
        stroke={palette.bg}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={23} cy={9} r={2.6} fill={palette.acc} />
    </Svg>
  );
}
