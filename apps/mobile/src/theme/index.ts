/**
 * 界面的设计 token：漫画风（docs/design/comic/mobile/），和网页端同一套。
 *
 * 浅灰的页面底色上放白底墨线的格子；描边 2.5（格子、按钮、选项、面板）/ 2（输入框、图标按钮、封面、小控件）/
 * 1.5（小标签、分隔线）。只用硬投影（一像素一层叠出来，hardShadow），不用模糊阴影：图标按钮 2，按钮、选项、
 * Tab 栏、菜单、浮条 4，对话框 6；主按钮和选中、聚焦的东西是蓝色投影。列表行和普通格子不加投影。
 * 按下时往投影的方向挪、投影缩短（components/press.ts），不缩放、不改透明度。不能点的按钮变灰、没有投影。
 * 蓝给可以点的和“你”；红只表示删除和出错，琥珀只表示警告，都配图标。不用渐变、插画、纸纹。
 *
 * 颜色随主题变：漫画颜色在 @bettertavern/design 的 comic.ts（useComic() 取当前主题那一套；外观面板的配色预览还用
 * themes.ts 里的色板）。描边、圆角、投影层数不随主题变。
 * 字号在 comicType.ts；字体族名是 React Native 加载字体用的键，只在手机端，在 fonts.ts（正文宋体按语言选也在那里）。
 */

export type { Palette } from "@bettertavern/design/palettes";
export {
  parseThemeSetting,
  resolveTheme,
  THEME_ORDER,
  THEMES,
  type Scheme,
  type ThemeDef,
  type ThemeId,
  type ThemeSetting,
} from "@bettertavern/design/themes";
export {
  comicDepth,
  comicRadius,
  comicStroke,
  hardShadow,
  type ComicColors,
} from "@bettertavern/design/comic";
export {
  BaseSurface,
  RaisedSurface,
  ThemeProvider,
  useComic,
  useIsDark,
  useTheme,
} from "./ThemeProvider.tsx";

export { onColor, size, space } from "@bettertavern/design/tokens";

export { ctype } from "./comicType.ts";
export { font, serifFor } from "./fonts.ts";
