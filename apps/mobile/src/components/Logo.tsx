/** 标志：墨色方块里一个反白的 R，右上角一个蓝点 */

import Svg, { Path, Rect } from "react-native-svg";

import { usePalette } from "../theme/index.ts";

export function Logo({ size = 32 }: { size?: number }) {
  const palette = usePalette();
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" accessibilityLabel="BetterTavern">
      <Rect width={28} height={28} fill={palette.ink} />
      <Path
        d="M7 21V7h7a4 4 0 010 8H7M14 15l6 6"
        stroke={palette.bg}
        strokeWidth={2}
        fill="none"
        strokeLinecap="square"
      />
      <Rect x={18} y={5} width={4} height={4} fill={palette.acc} />
    </Svg>
  );
}
