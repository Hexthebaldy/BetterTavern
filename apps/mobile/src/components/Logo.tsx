/**
 * 标志“错版”：两层错开的三角细框（像一次没对准的套印）套着一层规整的框，中间一块蓝色实心三角。
 * 几何、配色和用法见 docs/design/logo/README.md；坐标与 docs/design/logo/svg/logo.svg 一致
 * （120 栅格，三角形的重心在 60,66）。线条用 ink、内核用 acc，深色模式自动反白。
 */

import Svg, { G, Path } from "react-native-svg";

import { usePalette } from "../theme/index.ts";

const FRAME_A = "M57.00 18.84 L100.00 93.32 L14.00 93.32Z";
const FRAME_B = "M66.04 13.95 L104.39 90.92 L18.56 85.65Z";
const INNER = "M60.00 33.67 L88.00 82.17 L32.00 82.17Z";
const CORE = "M60.00 50.99 L73.00 73.51 L47.00 73.51Z";

/** 紧贴标志的方形视窗，留出最粗线宽时尖角的余量 */
const VIEW_BOX = "9.35 2.66 99.55 99.55";

/**
 * 光学尺寸：越小线越粗，保证小尺寸下仍能看出外框是两条线。
 * 阈值按标志自身的边长算（和 App 图标里“图标边长 100 / 56 / 36”三档等价）。
 */
function strokeScale(size: number): number {
  if (size >= 72) return 1;
  if (size >= 40) return 1.35;
  if (size >= 26) return 1.6;
  return 2;
}

export function Logo({ size = 48 }: { size?: number }) {
  const palette = usePalette();
  const m = strokeScale(size);
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} accessibilityLabel="BetterTavern">
      <G fill="none" stroke={palette.ink} strokeLinejoin="miter" strokeMiterlimit={4}>
        <Path d={FRAME_A} strokeWidth={2.4 * m} />
        <Path d={FRAME_B} strokeWidth={2.4 * m} />
        <Path d={INNER} strokeWidth={2.6 * m} />
      </G>
      <Path d={CORE} fill={palette.acc} />
    </Svg>
  );
}
