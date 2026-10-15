/**
 * 几何封面：图形在 @bettertavern/design 的 cover.ts（和 App 共用），这里按 CSS 变量上色。
 * 底色是当前表面上“灰块里再嵌的小块”（--on-fill）或灰块（--fill）。角色卡图片在剧本库那一步接上。
 */

import { coverArt, coverRadius } from "@bettertavern/design/cover";

export function GeometricCover({
  seed,
  width,
  height,
  surface = "fill",
  rounded,
  className,
}: {
  seed: string;
  width: number;
  height: number;
  /** fill：放在页面底上（灰）；onFill：放在灰卡里（白） */
  surface?: "fill" | "onFill";
  rounded?: number;
  className?: string;
}) {
  const art = coverArt(seed, width, height);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={className}
      style={{
        flex: "none",
        display: "block",
        borderRadius: rounded ?? coverRadius(width, height),
        background: surface === "onFill" ? "var(--on-fill)" : "var(--fill)",
      }}
    >
      {art.shapes.map((shape, i) => {
        if (shape.kind === "path") {
          const soft = shape.tone === "soft";
          return (
            <path
              key={i}
              d={shape.d}
              fill="none"
              stroke={soft ? "var(--line2)" : "var(--ink)"}
              strokeWidth={soft ? art.softStrokeWidth : art.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin={soft ? undefined : "round"}
            />
          );
        }
        if (shape.tone === "focus") {
          return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill="var(--acc)" />;
        }
        return (
          <circle
            key={i}
            cx={shape.cx}
            cy={shape.cy}
            r={shape.r}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={art.strokeWidth}
          />
        );
      })}
    </svg>
  );
}
