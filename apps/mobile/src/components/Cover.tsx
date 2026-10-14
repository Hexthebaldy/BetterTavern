/**
 * 封面：角色卡有图片就显示图片（要带访问令牌才能取），没有图片时画一张几何封面。
 *
 * 几何封面按种子（剧本 ID）从 5 种线条母题里确定性地选一种：波浪、钟面、网格、拱桥、山峰，
 * 圆头的黑色线条加一个蓝色圆点。母题按实际宽高计算坐标，方形缩略图和通栏横幅都能用。
 * 封面是圆角方块（圆角 16 起，越大越圆）；放在灰卡里时用白色 card 底（surface="card"）。
 */

import { useEffect, useState } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useApp } from "../state/AppProvider.tsx";
import { usePalette, type Palette } from "../theme/index.ts";
import { Icon } from "./icons.tsx";

const MOTIFS = ["wave", "dial", "grid", "arch", "peak"] as const;
export type Motif = (typeof MOTIFS)[number];

/** FNV-1a：同一个 ID 总是得到同一种母题 */
export function motifFor(seed: string): Motif {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return MOTIFS[(hash >>> 0) % MOTIFS.length] ?? "wave";
}

function wave(y: number, width: number, period: number, amp: number): string {
  let d = `M0 ${y}q${period / 2} ${-amp} ${period} 0`;
  for (let x = period; x < width; x += period) d += `t${period} 0`;
  return d;
}

function Shapes({ motif, w, h, p }: { motif: Motif; w: number; h: number; p: Palette }) {
  const k = h / 96; // 位置和焦点按高度缩放
  const ks = Math.min(k, 2); // 重复的纹样（波长、间距）放大得慢一些
  const sw = h > 200 ? 1.8 : Math.min(Math.max(1.8 * k, 1.4), 3);
  const line = {
    stroke: p.ink,
    strokeWidth: sw,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const soft = {
    stroke: p.line2,
    strokeWidth: Math.max(sw * 0.8, 1),
    fill: "none",
    strokeLinecap: "round" as const,
  };
  const focus = (cx: number, cy: number, d: number) => <Circle cx={cx} cy={cy} r={d / 2} fill={p.acc} />;
  switch (motif) {
    case "wave": {
      const count = h >= 200 ? 4 : 3;
      const gap = 12 * ks;
      const ys = Array.from({ length: count }, (_, i) => h - gap * (count - i));
      const dot = 12 * k;
      return (
        <>
          <Path d={ys.map((y) => wave(y, w, 24 * ks, 6 * ks)).join("")} {...line} />
          {focus(w * 0.65 + dot / 2, h * 0.21 + dot / 2, dot * 1.3)}
        </>
      );
    }
    case "dial": {
      const cx = w / 2;
      const cy = h * 0.46;
      const r = h * 0.27;
      const dot = 6 * k;
      return (
        <>
          <Circle cx={cx} cy={cy} r={r} {...line} />
          <Path
            d={`M${cx} ${cy}V${cy - r * 0.69}M${cx} ${cy}l${r * 0.46} ${r * 0.31}M${cx - r * 1.54} ${h}V${h * 0.83}M${cx + r * 1.54} ${h}V${h * 0.83}`}
            {...line}
          />
          {focus(cx, cy, dot * 1.2)}
        </>
      );
    }
    case "grid": {
      const inset = 12 * k;
      const size = h - inset * 2;
      const step = size / 3;
      let grid = `M${inset} ${inset + step}H${w - inset}M${inset} ${inset + step * 2}H${w - inset}`;
      for (let x = inset + step; x < w - inset; x += step) grid += `M${x} ${inset}V${h - inset}`;
      const dot = 8 * k;
      return (
        <>
          <Path d={grid} {...soft} />
          <Path d={`M${inset} ${h - inset}A${size} ${size} 0 0 1 ${inset + size} ${inset}`} {...line} />
          {focus(inset + size * 0.667, inset + size * 0.333, dot * 1.3)}
        </>
      );
    }
    case "arch": {
      const base = h * 0.73;
      const r = 28 * k;
      const cx = w / 2;
      const dot = 10 * k;
      return (
        <>
          <Path d={`M0 ${h * 0.31}H${w}M0 ${h * 0.44}H${w * 0.625}`} {...soft} />
          <Path
            d={`M${8 * k} ${base}H${w - 8 * k}M${cx - r} ${base}A${r} ${r} 0 0 1 ${cx + r} ${base}`}
            {...line}
          />
          {focus(w * 0.73 + dot / 2, h * 0.375 + dot / 2, dot * 1.3)}
        </>
      );
    }
    case "peak": {
      const base = h * 0.83;
      const x0 = w / 2 - 50 * k;
      const tri = (a: number, top: number, b: number, height: number): string =>
        `M${x0 + a * k} ${base}L${x0 + top * k} ${base - height * k}L${x0 + b * k} ${base}Z`;
      return (
        <>
          <Path d={tri(14, 28, 42, 32) + tri(40, 56, 72, 44) + tri(66, 76, 86, 24)} {...line} />
          <Path d={`M0 ${base}H${w}`} {...line} />
          {focus(x0 + 56 * k, base - 14 * k, 9 * k)}
        </>
      );
    }
  }
}

/** 封面的圆角：16 起，越大越圆，最大 34 */
export function coverRadius(width: number, height: number): number {
  return Math.round(Math.min(Math.max(Math.min(width, height) * 0.28, 16), 34));
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
        <Shapes motif={motifFor(seed)} w={width} h={height} p={palette} />
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
        source={{ uri: `${serverUrl}${api.scenarios.blobPath(blobId)}`, headers }}
        onError={() => setFailed(true)}
        style={{ width, height }}
        resizeMode="cover"
      />
    </View>
  );
}
