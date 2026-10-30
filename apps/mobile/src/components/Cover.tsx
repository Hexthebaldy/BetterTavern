/**
 * 封面：角色卡有图片就显示图片（要带访问令牌才能取，先下载到本机，见 hooks/useBlobUri.ts），没有图片时画一张几何封面。
 *
 * 几何封面的图形（5 种线条母题，按剧本 ID 确定性地选）在 @bettertavern/design 的 cover.ts，和网页端共用；
 * 这里按漫画颜色上色：灰底、墨线、蓝点。圆角默认 9；framed 时外面一圈 2 的墨线（列表、网格里的方形封面）。
 * 放在灰底上时用白底（surface="card"）。
 */

import { useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { coverArt } from "@bettertavern/design/cover";

import { useBlobUri } from "../hooks/useBlobUri.ts";
import { comicRadius, comicStroke, useComic, type ComicColors } from "../theme/index.ts";
import { Icon } from "./icons.tsx";

/** 几何封面的图形（@bettertavern/design 的 cover.ts）按当前的漫画颜色画出来 */
function Shapes({ seed, w, h, p }: { seed: string; w: number; h: number; p: ComicColors }) {
  const art = coverArt(seed, w, h);
  const line = {
    stroke: p.ink,
    strokeWidth: art.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const soft = {
    stroke: p.line,
    strokeWidth: art.softStrokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
  };
  return (
    <>
      {art.shapes.map((shape, i) => {
        if (shape.kind === "path")
          return <Path key={i} d={shape.d} {...(shape.tone === "soft" ? soft : line)} />;
        if (shape.tone === "focus")
          return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={p.acc} />;
        return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...line} />;
      })}
    </>
  );
}

export function GeometricCover({
  seed,
  width,
  height,
  surface = "grey",
  rounded,
  framed,
  style,
}: {
  seed: string;
  width: number;
  height: number;
  /** 底色：grey 用于白底上，card 用于灰底上 */
  surface?: "grey" | "card";
  /** 圆角，默认 9；嵌在格子顶上时传 0 */
  rounded?: number;
  /** 外面一圈 2 的墨线 */
  framed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: rounded ?? comicRadius.cover,
          backgroundColor: surface === "card" ? c.paper : c.grey,
          overflow: "hidden",
        },
        framed ? { borderWidth: comicStroke.control, borderColor: c.ink } : null,
        style,
      ]}
    >
      <Svg width={width} height={height} accessible={false}>
        <Shapes seed={seed} w={width} h={height} p={c} />
      </Svg>
    </View>
  );
}

/** 角色卡图片；取不到图片时退回几何封面 */
export function Cover({
  seed,
  blobId,
  width,
  height,
  surface,
  rounded,
  framed,
  style,
}: {
  seed: string;
  blobId: string | null | undefined;
  width: number;
  height: number;
  surface?: "grey" | "card";
  rounded?: number;
  framed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const blob = useBlobUri(blobId);
  // 下载下来了却解不开（坏图）：同一张图退回几何封面
  const [broken, setBroken] = useState<string | null>(null);
  const failed = blob.failed || (blob.uri !== null && broken === blob.uri);

  const r = rounded ?? comicRadius.cover;
  const frame = framed ? { borderWidth: comicStroke.control, borderColor: c.ink } : null;
  if (!blobId || failed) {
    return (
      <GeometricCover
        seed={seed}
        width={width}
        height={height}
        surface={surface}
        rounded={rounded}
        framed={framed}
        style={style}
      />
    );
  }
  if (!blob.uri) {
    return (
      <View
        style={[
          {
            width,
            height,
            borderRadius: r,
            backgroundColor: c.grey2,
            alignItems: "center",
            justifyContent: "center",
          },
          frame,
          style,
        ]}
      >
        <Icon name="image" size={Math.min(28, height / 3)} color={c.mut} />
      </View>
    );
  }
  return (
    <View
      style={[{ width, height, borderRadius: r, overflow: "hidden", backgroundColor: c.grey2 }, frame, style]}
    >
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: blob.uri }}
        onError={() => setBroken(blob.uri)}
        style={{ width, height }}
        resizeMode="cover"
      />
    </View>
  );
}
