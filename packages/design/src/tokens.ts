/**
 * 不随主题变的几个数值：间距、手机端的控件尺寸、网页图标的线宽，手机端和网页端共用。
 *
 * 漫画风的描边、圆角、投影层数在 comic.ts，手机端的字号在 apps/mobile 的 theme/comicType.ts，网页的在 tokens.css。
 * 以前那套“白底柔线大圆角”的圆角、字号阶梯（docs/design/ui/tokens.ts）两端都不用了，已经删掉。
 */

/** 红底、蓝底上的白字（所有主题都一样） */
export const onColor = "#FFFFFF";

/** 网页图标的描边（手机端的图标线宽在 apps/mobile 的 components/icons.tsx） */
export const stroke = { icon: 1.75 };

/** 4pt 栅格；一级页左右 24、列表卡片区左右 12、阅读页正文 24 */
export const space = { xs: 4, s: 8, m: 12, l: 16, page: 24, list: 12, read: 24, xl: 28, xxl: 36 };

/** 手机端的控件尺寸 */
export const size = {
  /** 最小热区 */
  touch: 44,
  /** 浮动 Tab 栏：高 64，左右 20 */
  tabBar: 64,
  /** 阅读页流式光标：3 宽的蓝色竖条 */
  caret: { width: 3, height: 20 },
};
