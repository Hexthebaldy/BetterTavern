/**
 * 色板：每个主题一套，字段完全相同（Palette 类型强制填全）。取值来自 docs/design/ui/tokens.ts。
 * 这里只放颜色和投影；圆角、字号、间距不随主题变（见 index.ts）。
 */

export type Palette = {
  /** 页面底色 */
  bg: string;
  /** 灰卡：列表卡片、分组、输入框、“我的行动”卡片、次要按钮 */
  bg2: string;
  /** 凹面：骨架屏、滑杆 / 进度轨道、卡片里再嵌一层的底 */
  bg3: string;
  /** 主文字、选中态底、Tab 选中胶囊 */
  ink: string;
  /** 次级正文 */
  ink2: string;
  /** 说明、占位、未选中图标 */
  mut: string;
  /** 卡片内部行与行之间的分隔（不画外框） */
  line: string;
  /** 拖拽条、未选中单选圈 */
  line2: string;
  /** 强调：“我”、选中项、流式光标、聚焦圈 */
  acc: string;
  accBg: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  err: string;
  errBg: string;
  /** 叙述正文（深色下比 ink 低一档，减少眩光） */
  narr: string;
  /** 主按钮 */
  pri: string;
  onPri: string;
  /** 浮层：Tab 栏、提示浮条、对话框；灰卡里再嵌的白卡 */
  card: string;
  /** 各类底部面板、对话框、弹出菜单 */
  sheet: string;
  /** 面板、对话框后面的遮罩 */
  scrim: string;
  /** 主按钮右侧箭头圆的底色（半透明）；墨色卡片上的半透明层也用它 */
  arrowBg: string;
  /** 墨色卡片（设置页的导演模型卡）上的蓝和绿：取另一种模式下的值，保证对比度 */
  accOnInk: string;
  okOnInk: string;
  /** 浅色底的提示条上，关闭按钮的半透明圆底 */
  closeOnTint: string;
  /** 浮层投影（CSS box-shadow，RN 新架构直接支持） */
  shadowFloat: string;
  /** 底部面板向上的投影 */
  shadowUp: string;
  /** 选中的分段、字号档位等“小浮起” */
  shadowLift: string;
  /** 开关和滑杆的圆形滑块 */
  shadowKnob: string;
  /** 叠在封面图上的白色圆按钮 */
  shadowButton: string;
  /** 墨色的浮起按钮（“回到最新”） */
  shadowStrong: string;
  /** 导航选中项的图标和文字（两种模式同一个蓝） */
  tabOn: string;
  /** 导航里滑动的玻璃框：没有底色，只有一圈半透明描边 */
  tabGlassEdge: string;
  /** 玻璃框的内侧高光和外侧淡蓝投影（网页） */
  tabGlassShadow: string;
  /** 没有液态玻璃时（Android、iOS 26 以前）选中框的灰色投影，描边不带光晕 */
  tabCapsuleShadow: string;
};

export const lightPalette: Palette = {
  bg: "#FFFFFF",
  bg2: "#F5F5F2",
  bg3: "#EBEBE7",
  ink: "#1A1A1A",
  ink2: "#3D3C38",
  mut: "#6E6D68",
  line: "#EEEEEA",
  line2: "#DCDCD6",
  acc: "#2F55F4",
  accBg: "#EEF2FF",
  ok: "#13875A",
  okBg: "#E9F6EF",
  warn: "#B25A0B",
  warnBg: "#FFF4E4",
  err: "#D3392B",
  errBg: "#FDEEEB",
  narr: "#222222",
  pri: "#1A1A1A",
  onPri: "#FFFFFF",
  card: "#FFFFFF",
  sheet: "#FFFFFF",
  scrim: "rgba(20,20,20,0.38)",
  arrowBg: "rgba(255,255,255,0.14)",
  accOnInk: "#8597FF",
  okOnInk: "#43C98C",
  closeOnTint: "rgba(255,255,255,0.6)",
  shadowFloat: "0 1px 2px rgba(20,20,20,0.05), 0 8px 28px rgba(20,20,20,0.10)",
  shadowUp: "0 -2px 6px rgba(20,20,20,0.03), 0 -10px 32px rgba(20,20,20,0.08)",
  shadowLift: "0 1px 3px rgba(20,20,20,0.12)",
  shadowKnob: "0 1px 4px rgba(0,0,0,0.3)",
  shadowButton: "0 2px 8px rgba(20,20,20,0.08)",
  shadowStrong: "0 6px 20px rgba(20,20,20,0.22)",
  tabOn: "#5B7CFF",
  tabGlassEdge: "rgba(91,124,255,0.45)",
  tabGlassShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 10px rgba(91,124,255,0.16)",
  tabCapsuleShadow: "0 2px 8px rgba(20,20,20,0.14)",
};

export const darkPalette: Palette = {
  bg: "#111113",
  bg2: "#1C1C1F",
  bg3: "#27272B",
  ink: "#F2F2F0",
  ink2: "#D3D3CF",
  mut: "#9C9C97",
  line: "#2A2A2F",
  line2: "#3A3A40",
  acc: "#8597FF",
  accBg: "#1F2546",
  ok: "#43C98C",
  okBg: "#11281D",
  warn: "#F0B257",
  warnBg: "#2C2213",
  err: "#FF7466",
  errBg: "#2F1715",
  narr: "#E2E2DE",
  pri: "#F2F2F0",
  onPri: "#111113",
  card: "#2A2A2F",
  sheet: "#1F1F23",
  scrim: "rgba(0,0,0,0.6)",
  arrowBg: "rgba(0,0,0,0.08)",
  accOnInk: "#2F55F4",
  okOnInk: "#13875A",
  closeOnTint: "rgba(255,255,255,0.6)",
  shadowFloat: "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.5)",
  shadowUp: "0 -2px 6px rgba(0,0,0,0.3), 0 -10px 32px rgba(0,0,0,0.5)",
  shadowLift: "0 1px 3px rgba(20,20,20,0.12)",
  shadowKnob: "0 1px 4px rgba(0,0,0,0.3)",
  shadowButton: "0 2px 8px rgba(20,20,20,0.08)",
  shadowStrong: "0 6px 20px rgba(20,20,20,0.22)",
  tabOn: "#5B7CFF",
  tabGlassEdge: "rgba(91,124,255,0.5)",
  tabGlassShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 12px rgba(91,124,255,0.22)",
  tabCapsuleShadow: "0 2px 8px rgba(0,0,0,0.5)",
};
