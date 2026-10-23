/**
 * 标志“错版”：几何在 @bettertavern/design 的 logo.ts（和 App 共用）。线条用 ink、内核用 acc，深色下自动反白。
 * inverse：放在墨底上（展开的轮盘中心），线条用纸色、内核用浅蓝。
 */

import { LOGO, logoStrokeScale } from "@bettertavern/design/logo";

export function Logo({
  size = 48,
  label = "BetterTavern",
  inverse,
}: {
  size?: number;
  label?: string | null;
  inverse?: boolean;
}) {
  const m = logoStrokeScale(size);
  return (
    <svg
      width={size}
      height={size}
      viewBox={LOGO.viewBox}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none" }}
    >
      <g
        fill="none"
        stroke={inverse ? "var(--on-ink)" : "var(--ink)"}
        strokeLinejoin="miter"
        strokeMiterlimit={4}
      >
        <path d={LOGO.frameA} strokeWidth={LOGO.frameStroke * m} />
        <path d={LOGO.frameB} strokeWidth={LOGO.frameStroke * m} />
        <path d={LOGO.inner} strokeWidth={LOGO.innerStroke * m} />
      </g>
      <path d={LOGO.core} fill={inverse ? "var(--sky)" : "var(--acc)"} />
    </svg>
  );
}
