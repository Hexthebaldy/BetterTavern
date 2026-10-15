/**
 * 界面「白 / 柔线 / 大圆角」的设计 token，取自 docs/design/ui/tokens.ts。
 *
 * 纯白页面，内容放在浅灰圆角卡片里；按钮、标签、分段控件是胶囊；分区靠灰卡和留白，不画黑线。
 * 层级靠“灰卡放在白底上”：页面 bg，卡片和输入框 bg2，卡片里再嵌一层用 bg3 或白色的 card。
 * 阴影只给浮起来的东西（Tab 栏、底部面板、提示浮条、弹出菜单）。
 * 状态靠换底色：未选中浅灰，选中黑底或浅蓝底加 2px 蓝色内描边，聚焦一圈 2px acc，按下缩到 97%，禁用不透明度 0.3。
 * 红 / 绿 / 琥珀只表示错误 / 可用 / 警告，并且一定配图标。
 *
 * 颜色和投影随主题变：色板、主题表在 @bettertavern/design 的 palettes.ts、themes.ts，页面用 usePalette() 取当前主题的色板。
 * 圆角、字号、间距、尺寸不随主题变，在 @bettertavern/design 的 tokens.ts（和网页端共用）；这里统一转出，页面只从这里导入。
 * 字体族名是 React Native 加载字体用的键，只在手机端，留在这里。
 */

export { lightPalette, darkPalette, type Palette } from "@bettertavern/design/palettes";
export {
  parseThemeSetting,
  resolveTheme,
  settingLabel,
  SYSTEM_SETTING,
  THEME_ORDER,
  THEMES,
  type Scheme,
  type ThemeDef,
  type ThemeId,
  type ThemeSetting,
} from "@bettertavern/design/themes";
export {
  BaseSurface,
  RaisedSurface,
  raisedPalette,
  ThemeProvider,
  useIsDark,
  usePalette,
  useTheme,
} from "./ThemeProvider.tsx";

export { onColor, radius, size, space, stroke, type } from "@bettertavern/design/tokens";

/**
 * 字体族。sans 用系统字体（不打包）；mono 用 IBM Plex Mono；serif 用思源宋体的 GB2312 子集
 * （assets/fonts，生成方法见 scripts/font-subset-chars.py）。名字与根布局 useFonts 的键一致。
 */
export const font = {
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  serif: "NotoSerifSC-Regular",
};
