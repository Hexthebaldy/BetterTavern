/**
 * 故事流（StoryFeed.tsx）里的几块（漫画风，docs/design/comic/mobile/README.md 的“阅读页”）：
 * 书名页、叙述、你的行动、流式光标、开场的两步、结束标记、开场还没写好。
 *
 * 导演写的和你的行动都从左往右排，用同样的字（阅读设置里的宋体或黑体、字号）、同样的墨色；不分气泡、不进框、
 * 没有回合号。你的行动只在左边多一道 3 的蓝色竖线，左内边距 13。正文左右 24，段距 14。
 * 流式光标是 3 宽的蓝色竖条，不闪烁。写完结局的故事，最后一段下面居中“— END —”。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View, type TextStyle } from "react-native";

import type { Persona } from "@bettertavern/core/api/types";
import { BASE_SIZE, lineHeightFor, MAX_SIZE, readingSize, type ReadingPrefs } from "@bettertavern/core/play/reading";

import { Cover } from "../../components/Cover.tsx";
import { Portrait } from "../../components/Portrait.tsx";
import { Icon, Pill } from "../../components/ui.tsx";
import { comicRadius, comicStroke, serifFor, size, space, useComic } from "../../theme/index.ts";

/** 正文左右的页边距、段与段之间 */
export const READ_SIDE = space.read;
export const PARAGRAPH_GAP = 14;

export function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * 叙述正文的字体和字号：没设置字号时跟随系统的动态字体，放大到 24 为止。
 * 宋体按这一局的语言选（language 是 playthroughs.language），不按界面语言。
 */
export function useNarrativeStyle(
  prefs: ReadingPrefs,
  language: string,
): {
  style: TextStyle;
  scale: boolean;
  maxScale: number;
} {
  const c = useComic();
  return useMemo(() => {
    const fontSize = readingSize(prefs);
    return {
      style: {
        fontFamily: prefs.font === "serif" ? serifFor(language) : undefined,
        fontSize,
        lineHeight: lineHeightFor(fontSize),
        letterSpacing: fontSize * 0.01,
        color: c.ink,
        textAlign: "justify",
      },
      scale: prefs.size === null,
      maxScale: MAX_SIZE / BASE_SIZE,
    };
  }, [prefs, c, language]);
}

export type Narr = ReturnType<typeof useNarrativeStyle>;

/** 书名页：往上翻到顶看到的第一屏（白底墨线的格子：封面在上，下面剧本名、主角色和“我是 林川”）。
 * 开局时用了人设的，“我是 林川”前面放它的头像（docs/personas.md 第 5、7 节：阅读页只放在这里） */
export function BookHeader({
  seed,
  blobId,
  title,
  card,
  protagonist,
  persona,
  width,
}: {
  seed: string;
  blobId: string | null;
  title: string;
  card: string | null;
  protagonist: string;
  persona?: Persona;
  width: number;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const inner = width - READ_SIDE * 2 - comicStroke.frame * 2;
  return (
    <View style={[styles.book, { borderColor: c.ink, backgroundColor: c.paper }]}>
      <View style={[styles.bookCover, { borderBottomColor: c.ink }]}>
        <Cover seed={seed} blobId={blobId} width={inner} height={116} rounded={0} />
      </View>
      <View style={styles.bookBody}>
        <Text style={[styles.bookTitle, { color: c.ink }]}>{title}</Text>
        {card || protagonist ? (
          <View style={styles.bookChips}>
            {card ? <Pill label={card} tone="card" height={26} /> : null}
            {protagonist && persona ? (
              <Portrait name={persona.name} seed={persona.id} blobId={persona.avatar_blob_id} size={26} rounded={13} />
            ) : null}
            {protagonist ? <Pill label={t("play.iAm", { name: protagonist })} tone="accSolid" height={26} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** 你的行动：和叙述同样的字、同样的墨色，左边一道 3 的蓝线；读屏时前面加上“我的行动：” */
export function ActionNote({ text, narr }: { text: string; narr: Narr }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t("play.myAction", { text })}
      style={[styles.note, { borderLeftColor: c.acc }]}
    >
      <Text
        selectable
        allowFontScaling={narr.scale}
        maxFontSizeMultiplier={narr.maxScale}
        style={[narr.style, { textAlign: "left" }]}
      >
        {text}
      </Text>
    </View>
  );
}

function Caret({ color, height }: { color: string; height: number }) {
  const width = size.caret.width;
  return <View style={{ width, height, marginLeft: 3, borderRadius: width / 2, backgroundColor: color }} />;
}

export function Narrative({
  text,
  narr,
  dim,
  caret,
  interrupted,
}: {
  text: string;
  narr: Narr;
  dim?: boolean;
  /** 光标颜色；不传就不画光标 */
  caret?: string;
  interrupted?: boolean;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const parts = paragraphs(text);
  const caretHeight = Math.round((narr.style.fontSize ?? 17) * 1.2);
  if (parts.length === 0) {
    return caret ? (
      <View style={[styles.caretOnly, { height: narr.style.lineHeight }]}>
        <Caret color={caret} height={caretHeight} />
      </View>
    ) : null;
  }
  return (
    <View>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <Text
            key={i}
            selectable
            allowFontScaling={narr.scale}
            maxFontSizeMultiplier={narr.maxScale}
            style={[
              narr.style,
              styles.paragraph,
              last ? { marginBottom: 0 } : null,
              dim ? { color: c.ink2 } : null,
            ]}
          >
            {p}
            {last && caret ? <Caret color={caret} height={caretHeight} /> : null}
            {last && interrupted ? (
              <View style={[styles.cutBox, { borderColor: c.ink }]}>
                <Text style={[styles.cut, { color: c.ink }]}>{t("play.interrupted")}</Text>
              </View>
            ) : null}
          </Text>
        );
      })}
    </View>
  );
}

/** 第一次开场：先搭建世界，再写开场。白底墨线的格子，当前一步是蓝字 */
export function OpeningSteps({ building }: { building: boolean }) {
  const c = useComic();
  const { t } = useTranslation();
  const step = (label: string, state: "active" | "done" | "todo") => (
    <View style={styles.stepRow}>
      {state === "active" ? (
        <View style={[styles.stepMark, { borderWidth: 6, borderColor: c.acc, boxShadow: `0 0 0 2px ${c.ink}` }]} />
      ) : state === "done" ? (
        <View style={[styles.stepMark, { borderColor: c.ink, backgroundColor: c.ink }]}>
          <Icon name="check" size={13} color={c.paper} strokeWidth={2.8} />
        </View>
      ) : (
        <View style={[styles.stepMark, { borderColor: c.line2, backgroundColor: c.paper }]} />
      )}
      <Text
        style={{
          fontSize: 14.5,
          fontWeight: state === "todo" ? "400" : "700",
          color: state === "active" ? c.acc : state === "done" ? c.ink : c.mut,
        }}
      >
        {label}
      </Text>
    </View>
  );
  return (
    <View accessibilityLiveRegion="polite">
      <View style={[styles.steps, { borderColor: c.ink, backgroundColor: c.paper }]}>
        {step(building ? t("play.building") : t("play.buildWorld"), building ? "active" : "done")}
        <View style={{ height: comicStroke.chip, backgroundColor: c.grey2 }} />
        {step(building ? t("play.writeOpening") : t("play.writingOpeningStep"), building ? "todo" : "active")}
      </View>
      <Text style={[styles.stepNote, { color: c.mut }]}>{t("play.slowNote")}</Text>
    </View>
  );
}

/** 写完结局：最后一段下面居中“— END —” */
export function EndMark() {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Text accessibilityLabel={t("play.theEnd")} style={[styles.end, { color: c.ink }]}>
      — END —
    </Text>
  );
}

/** 开场还没写（上次中断了） */
export function OpeningMissing() {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <View style={styles.missing}>
      <Icon name="untested" size={20} color={c.warn} />
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 24, fontWeight: "600", color: c.warn }}>
        {t("play.noOpening")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  book: {
    marginTop: space.l,
    marginHorizontal: READ_SIDE,
    marginBottom: space.page,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  bookCover: { borderBottomWidth: comicStroke.frame },
  bookBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 10 },
  bookTitle: { fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.6 },
  bookChips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  /** 蓝线在正文的左边距上，字往里缩 13 */
  note: {
    marginBottom: PARAGRAPH_GAP,
    marginLeft: READ_SIDE,
    marginRight: READ_SIDE,
    paddingLeft: 13,
    borderLeftWidth: 3,
  },
  paragraph: { marginBottom: PARAGRAPH_GAP, paddingHorizontal: READ_SIDE },
  caretOnly: { paddingHorizontal: READ_SIDE - 3, justifyContent: "center" },
  cutBox: {
    marginLeft: space.s,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: comicRadius.chip,
    borderWidth: comicStroke.chip,
    justifyContent: "center",
  },
  cut: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  steps: {
    marginHorizontal: READ_SIDE,
    marginTop: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.m, height: 54, paddingHorizontal: 14 },
  stepMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNote: { fontSize: 13, lineHeight: 20, paddingHorizontal: READ_SIDE, paddingTop: space.m },
  missing: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: READ_SIDE,
    paddingTop: space.l,
  },
  end: {
    textAlign: "center",
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "900",
    letterSpacing: 4,
  },
});
