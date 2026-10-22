/**
 * 封面：角色卡有图片就显示图片（要带访问令牌才能取），没有图片时画一张几何封面。
 *
 * 几何封面的图形（5 种线条母题，按剧本 ID 确定性地选）在 @bettertavern/design 的 cover.ts，和网页端共用；
 * 这里按色板上色。封面是圆角方块（圆角 16 起，越大越圆）；放在灰卡里时用白色 card 底（surface="card"）。
 */

import { useEffect, useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { coverArt, coverRadius } from "@bettertavern/design/cover";

import { useApp } from "../state/AppProvider.tsx";
import { usePalette, type Palette } from "../theme/index.ts";
import { Icon } from "./icons.tsx";

/** 几何封面的图形（@bettertavern/design 的 cover.ts）按当前色板画出来 */
function Shapes({ seed, w, h, p }: { seed: string; w: number; h: number; p: Palette }) {
  const art = coverArt(seed, w, h);
  const line = {
    stroke: p.ink,
    strokeWidth: art.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const soft = {
    stroke: p.line2,
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
  style,
}: {
  seed: string;
  width: number;
  height: number;
  /** 底色：grey 用于白底页面上，card 用于灰卡里 */
  surface?: "grey" | "card";
  /** 指定圆角（嵌在卡片里时按“外层圆角 − 内边距”算） */
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: rounded ?? coverRadius(width, height),
          backgroundColor: surface === "card" ? palette.card : palette.bg2,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Svg width={width} height={height} accessible={false}>
        <Shapes seed={seed} w={width} h={height} p={palette} />
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
  style,
}: {
  seed: string;
  blobId: string | null | undefined;
  width: number;
  height: number;
  surface?: "grey" | "card";
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { api, authHeaders, serverUrl } = useApp();
  const palette = usePalette();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!blobId) return;
    let alive = true;
    authHeaders()
      .then((h) => {
        if (alive) setHeaders(h);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [blobId, authHeaders]);

  const r = rounded ?? coverRadius(width, height);
  if (!blobId || failed) {
    return (
      <GeometricCover
        seed={seed}
        width={width}
        height={height}
        surface={surface}
        rounded={rounded}
        style={style}
      />
    );
  }
  if (!headers) {
    return (
      <View
        style={[
          {
            width,
            height,
            borderRadius: r,
            backgroundColor: palette.bg3,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
      >
        <Icon name="image" size={Math.min(28, height / 3)} color={palette.mut} />
      </View>
    );
  }
  return (
    <View
      style={[{ width, height, borderRadius: r, overflow: "hidden", backgroundColor: palette.bg3 }, style]}
    >
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: `${serverUrl}${api.blobPath(blobId)}`, headers }}
        onError={() => setFailed(true)}
        style={{ width, height }}
        resizeMode="cover"
      />
    </View>
  );
}
