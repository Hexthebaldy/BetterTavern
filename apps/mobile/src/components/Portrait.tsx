/**
 * 人物位（docs/design/comic 的“人物头像”）：角色卡有图片就放图片，没有就用名字里的一个大字压在网点底上。
 * 取哪个字、用哪种底在 @bettertavern/design 的 portrait.ts（和网页共用），同一个角色在几页上一样。
 * 外面一圈 2 的墨线，圆角默认 9。
 */

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { isDarkTone, portraitGlyph, portraitTone, type PanelTone } from "@bettertavern/design/portrait";

import { comicRadius, comicStroke, useComic } from "../theme/index.ts";
import { Cover } from "./Cover.tsx";
import { Halftone } from "./Halftone.tsx";

export function Portrait({
  name,
  seed,
  blobId,
  size,
  height = size,
  rounded = comicRadius.cover,
  tone: forcedTone,
  style,
}: {
  name: string;
  /** 选底用的 ID（角色卡、草稿的 ID） */
  seed: string;
  blobId?: string | null;
  size: number;
  /** 不是正方形时的高（库里世界书的格子顶上一条）；不传就和 size 一样 */
  height?: number;
  rounded?: number;
  /** 指定底（剧本里的主角色是蓝网点）；不传就按 seed 选 */
  tone?: PanelTone;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  if (blobId) {
    return <Cover seed={seed} blobId={blobId} width={size} height={height} rounded={rounded} framed style={style} />;
  }
  const tone = forcedTone ?? portraitTone(seed);
  const fg = tone === "blue" ? c.onAcc : isDarkTone(tone) ? c.paper : c.ink;
  const glyphSize = Math.min(size, height);
  const glyph = (
    <Text
      allowFontScaling={false}
      style={[styles.glyph, { fontSize: glyphSize * 0.72, lineHeight: glyphSize * 0.86, color: fg }]}
    >
      {portraitGlyph(name)}
    </Text>
  );
  const box = [
    styles.box,
    { width: size, height, borderRadius: rounded, borderColor: c.ink },
    style,
  ];
  if (tone === "blue" || tone === "dots" || tone === "grey") {
    return (
      <Halftone tone={tone === "blue" ? "acc" : tone === "dots" ? "ink" : "grey"} style={box}>
        {glyph}
      </Halftone>
    );
  }
  return <View style={[box, { backgroundColor: tone === "ink" ? c.ink : c.paper }]}>{glyph}</View>;
}

const styles = StyleSheet.create({
  box: {
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  glyph: { fontWeight: "900", textAlign: "center", marginBottom: -2 },
});
