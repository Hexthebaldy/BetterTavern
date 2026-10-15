/** 标志“错版”：几何在 @bettertavern/design 的 logo.ts（和 App 共用）。线条用 ink、内核用 acc，深色下自动反白 */

import { LOGO, logoStrokeScale } from "@bettertavern/design/logo";

export function Logo({ size = 48, label = "BetterTavern" }: { size?: number; label?: string | null }) {
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
      <g fill="none" stroke="var(--ink)" strokeLinejoin="miter" strokeMiterlimit={4}>
        <path d={LOGO.frameA} strokeWidth={LOGO.frameStroke * m} />
        <path d={LOGO.frameB} strokeWidth={LOGO.frameStroke * m} />
        <path d={LOGO.inner} strokeWidth={LOGO.innerStroke * m} />
      </g>
      <path d={LOGO.core} fill="var(--acc)" />
    </svg>
  );
}
