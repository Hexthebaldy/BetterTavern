/**
 * 标志“错版”：两层错开的三角外框套着规整的内框，中间一块蓝色三角。几何来自 @bettertavern/design 的 logo.ts，
 * 线宽按标志的边长乘 logoStrokeScale（越小越粗）。两条外框带 o1 / o2，悬停时样式表把它们错得更开。
 */

import { LOGO, logoStrokeScale } from "@bettertavern/design/logo";

const round = (n: number) => Math.round(n * 100) / 100;

/** size：标志在页面上的边长（px），用来定线宽；sized 为真时也写成 svg 的宽高（否则由样式表定） */
export function Logo({ size, sized = false, className }: { size: number; sized?: boolean; className?: string }) {
  const k = logoStrokeScale(size);
  const frame = round(LOGO.frameStroke * k);
  return (
    <svg
      className={className}
      width={sized ? size : undefined}
      height={sized ? size : undefined}
      viewBox={LOGO.viewBox}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinejoin="miter" strokeMiterlimit={4}>
        <path className="o1 fr" d={LOGO.frameA} strokeWidth={frame} />
        <path className="o2 fr" d={LOGO.frameB} strokeWidth={frame} />
        <path className="inr" d={LOGO.inner} strokeWidth={round(LOGO.innerStroke * k)} />
      </g>
      <path d={LOGO.core} style={{ fill: "var(--acc)" }} />
    </svg>
  );
}
