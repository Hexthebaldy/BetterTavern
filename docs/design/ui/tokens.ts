/**
 * 第一版正式 UI「白 / 柔线 / 大圆角」的设计 token 原稿，取自 docs/design/ui/source/*.dc.html。
 * App 里的取值在 apps/mobile/src/theme/（palettes.ts、index.ts），从这里搬过去后按实现做过少量调整：
 * 阅读页的浮动行动面板已经改成贴边的操作栏，floatingSheet 和“我的行动”卡片相关的取值不再使用（见 README“阅读页要点”）。
 * 对比度：文字色在对应底色上都 ≥ 4.5:1（mut 在白底上约 5.2:1）。
 */

export type PaletteSoft = {
  /** 页面底色 */
  bg: string;
  /** 灰卡：列表卡片、分组、输入框、“我的行动”卡片、次要按钮 */
  bg2: string;
  /** 凹面：骨架屏、滑杆/进度轨道、卡片里再嵌一层的底 */
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
  /** 浮层：Tab 栏、提示浮条、对话框 */
  card: string;
  /** 阅读页底部行动面板与各类底部面板 */
  sheet: string;
  /** 面板、对话框后面的遮罩 */
  scrim: string;
};

export const lightSoft: PaletteSoft = {
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
};

export const darkSoft: PaletteSoft = {
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
};

/**
 * 圆角阶梯。规则：容器越大，圆角越大；嵌套时内层圆角 = 外层圆角 − 内边距。
 * pill 用于按钮、标签、分段控件、Tab 栏：取控件高度的一半（RN 里写 height / 2）。
 */
export const radius = {
  tag: 10,
  input: 14,
  cover: 16,
  card: 20,
  /** 阅读页选项卡片、故事列表卡片 */
  option: 24,
  group: 28,
  sheet: 32,
  /** 阅读页浮起的行动面板（四周留 8） */
  floatingSheet: 36,
  /** 手机外框，只用于设计稿 */
  device: 44,
  pill: 999,
};

/**
 * 阴影只给浮起来的东西：Tab 栏、阅读页行动面板、提示浮条、“回到最新”。
 * 其他层级一律靠“灰卡放在白底上”表达。
 * 数值是 CSS 原值，RN 里 iOS 用 shadow*，Android 用 elevation 近似。
 */
export const shadow = {
  light: {
    float: "0 1px 2px rgba(20,20,20,.05), 0 8px 28px rgba(20,20,20,.10)",
    /** 底部面板向上投影 */
    up: "0 -2px 6px rgba(20,20,20,.03), 0 -10px 32px rgba(20,20,20,.08)",
  },
  dark: {
    float: "0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.5)",
    up: "0 -2px 6px rgba(0,0,0,.3), 0 -10px 32px rgba(0,0,0,.5)",
  },
};

/** 图标描边 1.75，圆头圆角；聚焦圈 2；错误输入框内描边 1.5 */
export const stroke = { icon: 1.75, focus: 2, error: 1.5, hair: 1 };

/** 字体族。sans 用系统字体（不打包）；mono 用 IBM Plex Mono；serif 用思源宋体子集 */
export const font = {
  sans: undefined as string | undefined,
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  serif: "NotoSerifSC-Regular",
  serifBold: "NotoSerifSC-SemiBold",
};

export const typeSoft = {
  /** 一级页大标题：故事 / 剧本 / 设置（标题下不画线） */
  display: { fontSize: 32, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.64 },
  /** 页面/面板标题、剧本名 */
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" as const },
  /** 阅读页导航栏标题 */
  navTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  /** 列表卡片标题 */
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" as const },
  /** 叙述正文：宋体，跟随阅读设置（15–24），行高 = 字号 × 1.77 */
  narrative: { fontSize: 17.5, lineHeight: 31, letterSpacing: 0.18 },
  /** “我的行动”卡片 */
  action: { fontSize: 15, lineHeight: 24, fontWeight: "500" as const },
  body: { fontSize: 15, lineHeight: 22 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: "500" as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  caption: { fontSize: 13, lineHeight: 19 },
  /** 等宽元信息：时间、计数、Key 尾号、上下文窗口 */
  meta: { fontSize: 12, lineHeight: 16 },
  /** Tab 栏未选中文字 */
  tab: { fontSize: 11, lineHeight: 14 },
};

/** 4pt 栅格；一级页左右 24、列表卡片区左右 12、阅读页正文 24、“我的行动”卡片外边距 16 */
export const spaceSoft = { xs: 4, s: 8, m: 12, l: 16, page: 24, list: 12, read: 24, xl: 28, xxl: 36 };

/** 控件尺寸 */
export const size = {
  button: 52,
  input: 52,
  touch: 44,
  /** 阅读页导航按钮（灰色圆底，热区仍是 44） */
  navButton: 40,
  /** 主按钮右侧的半透明箭头圆 */
  buttonArrow: 36,
  optionRow: 62,
  optionKey: 32,
  actionIcon: 26,
  icon: 22,
  /** 浮动 Tab 栏：高 64，左右 20，离底 28（再加安全区） */
  tabBar: 64,
  tabActive: 48,
  cover: 56,
  /** 生成中拖拽条形状的进度条 */
  handle: { width: 44, height: 5, segment: 18 },
  caret: { width: 3, height: 20 },
};
