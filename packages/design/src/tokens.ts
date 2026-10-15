/**
 * 不随主题变的设计 token：圆角、描边、字号、间距、控件尺寸。取自 docs/design/ui/tokens.ts，手机端和网页端共用。
 *
 * 规则：容器越大圆角越大；按钮、标签、分段控件是全圆；阴影只给浮起来的东西；
 * 状态靠换底色（未选中浅灰，选中黑底或浅蓝底加 2px 蓝色内描边，聚焦一圈 2px acc，按下缩到 97%，禁用不透明度 0.3）。
 * 颜色和投影随主题变，在 palettes.ts。字号里的 fontWeight 是字符串，React Native 和 CSS 都能直接用。
 */

/** 红底、蓝底上的白字（所有主题都一样） */
export const onColor = "#FFFFFF";

/**
 * 圆角阶梯。规则：容器越大，圆角越大；嵌套时内层圆角 = 外层圆角 − 内边距。
 * 按钮、标签、分段控件、Tab 栏是全圆（高度 / 2）。不要出现 2–8 这种小圆角。
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
  pill: 999,
};

/** 图标描边 1.75，圆头圆角；聚焦圈 2；错误输入框描边 1.5 */
export const stroke = { icon: 1.75, focus: 2, error: 1.5, hair: 1 };

export const type = {
  /** 一级页大标题：故事 / 剧本 / 设置（标题下不画线） */
  display: { fontSize: 32, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.64 },
  /** 剧本名等超大标题 */
  hero: { fontSize: 38, lineHeight: 44, fontWeight: "900" as const, letterSpacing: -1.1 },
  /** 页面 / 面板标题 */
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" as const },
  /** 分区标题 */
  section: { fontSize: 19, lineHeight: 26, fontWeight: "700" as const },
  /** 阅读页导航栏标题 */
  navTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  /** 列表卡片标题 */
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" as const },
  /** 叙述正文：宋体，跟随阅读设置（15–24），行高 = 字号 × 1.77 */
  narrative: { fontSize: 17.5, lineHeight: 31 },
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
export const space = { xs: 4, s: 8, m: 12, l: 16, page: 24, list: 12, read: 24, xl: 28, xxl: 36 };

/** 控件尺寸 */
export const size = {
  button: 52,
  input: 52,
  touch: 44,
  /** 导航按钮（灰色圆底，热区仍是 44） */
  navButton: 40,
  /** 主按钮右侧的半透明箭头圆 */
  buttonArrow: 36,
  chip: 40,
  optionRow: 62,
  optionKey: 32,
  icon: 22,
  /** 浮动 Tab 栏：高 64，左右 20 */
  tabBar: 64,
  tabActive: 48,
  cover: 56,
  /** 生成中拖拽条形状的进度条 */
  handle: { width: 44, height: 5, segment: 18 },
  caret: { width: 3, height: 20 },
};
