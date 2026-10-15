/**
 * 封面：角色卡有图片就显示图片（要带访问令牌才能取，见 data/blobs.ts），没有图片或取不到时画几何封面。
 * 几何封面的图形在 @bettertavern/design 的 cover.ts（和 App 共用），这里按 CSS 变量上色。
 * 底色是当前表面上的灰块（--fill）或灰块里再嵌的小块（--on-fill）。
 */

import { useState } from "react";

import { coverArt, coverRadius } from "@bettertavern/design/cover";

import { useBlobUrl } from "../data/blobs.ts";

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

/** 角色卡图片；没有图片、取不到或加载失败时退回几何封面 */
export function Cover({
  seed,
  blobId,
  width,
  height,
  surface,
  rounded,
  className,
}: {
  seed: string;
  blobId: string | null | undefined;
  width: number;
  height: number;
  surface?: "fill" | "onFill";
  rounded?: number;
  className?: string;
}) {
  const image = useBlobUrl(blobId);
  const [broken, setBroken] = useState(false);
  const radius = rounded ?? coverRadius(width, height);
  if (!blobId || image.isError || broken) {
    return (
      <GeometricCover
        seed={seed}
        width={width}
        height={height}
        surface={surface}
        rounded={rounded}
        className={className}
      />
    );
  }
  return (
    <span
      className={className}
      style={{
        display: "block",
        flex: "none",
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: "var(--bg3)",
      }}
    >
      {image.data ? (
        <img
          src={image.data}
          alt=""
          width={width}
          height={height}
          draggable={false}
          onError={() => setBroken(true)}
          style={{ display: "block", width, height, objectFit: "cover" }}
        />
      ) : null}
    </span>
  );
}
