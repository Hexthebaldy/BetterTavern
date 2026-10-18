/**
 * 字体族（docs/i18n.md 第 3 节“字体”）。名字与根布局 useFonts 的键一致。
 *
 * - sans：系统字体，不打包。界面文字和角色卡文字都用它，缺字时由 iOS / Android 按自己的规则回退。
 * - mono：IBM Plex Mono。
 * - serif：故事正文的宋体，中文、日文各打包一份子集（assets/fonts，生成方法见 scripts/font-subset-chars.py）：
 *   思源宋体简体中文版的 GB2312 子集、日文版的 JIS X 0208 子集。正文按这一局的语言选，不按界面语言：
 *   日文界面下读中文存档时，日文子集里缺很多简体字。
 */

export const font = {
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  serif: "NotoSerifSC-Regular",
  serifJa: "NotoSerifJP-Regular",
};

/** 正文宋体：日文的局用日文子集，其他（中文、英文）用中文子集（它也带拉丁字母） */
export function serifFor(language: string | null | undefined): string {
  return language === "ja" ? font.serifJa : font.serif;
}
