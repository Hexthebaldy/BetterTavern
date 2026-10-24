/**
 * 漫画风的字（docs/design/comic/mobile/README.md 的“视觉规则”）。手机端只用这一套。
 *
 * 稿子里宋体 900 的标题先用系统黑体的粗体顶替（不打包新字体），字号照稿子；阅读正文仍是打包的宋体，
 * 跟着阅读设置走（fonts.ts 的 serifFor）。稿子里等宽 700 的地方用现有的 500（font.monoMedium）。
 */

export const ctype = {
  /** 一级页的大标题 */
  display: { fontSize: 36, lineHeight: 44, fontWeight: "900" as const, letterSpacing: -0.7 },
  /** 页面里、格子里的大标题 */
  title: { fontSize: 20, lineHeight: 28, fontWeight: "900" as const },
  /** 面板、对话框的标题 */
  sheetTitle: { fontSize: 22, lineHeight: 28, fontWeight: "900" as const },
  /** 二级页导航栏的标题 */
  navTitle: { fontSize: 17, lineHeight: 22, fontWeight: "900" as const },
  /** 格子和列表里的标题 */
  frameTitle: { fontSize: 17, lineHeight: 22, fontWeight: "900" as const },
  /** 分区标题 */
  section: { fontSize: 16, lineHeight: 22, fontWeight: "800" as const },
  /** 列表行的标题（设置的一行） */
  rowTitle: { fontSize: 15.5, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 15, lineHeight: 22 },
  /** 选项：黑体 700 */
  option: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
  button: { fontSize: 16, lineHeight: 20, fontWeight: "700" as const },
  buttonSm: { fontSize: 14, lineHeight: 18, fontWeight: "700" as const },
  /** 输入框上面的标签 */
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" as const },
  caption: { fontSize: 13, lineHeight: 19 },
  /** 时间、数量、步骤号（等宽） */
  meta: { fontSize: 11.5, lineHeight: 16 },
  /** 小标签 */
  tag: { fontSize: 12, lineHeight: 16, fontWeight: "700" as const },
};
