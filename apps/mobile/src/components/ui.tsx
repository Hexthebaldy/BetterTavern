/**
 * 界面部件（漫画风，设计稿见 docs/design/comic/mobile/）。页面只从这里 import。
 *
 * - primitives.tsx：页面容器、加载、骨架、文字
 * - buttons.tsx：胶囊按钮、图标按钮；press.ts：按下的效果（往投影方向挪、投影缩短）
 * - rows.tsx：分组、列表行、分区标题
 * - feedback.tsx：提示条、标签、状态、加载失败
 * - controls.tsx：输入框、分段、标签、勾选、单选、开关
 * - bars.tsx：一级页大标题、二级页导航栏（useTabBarSpace() 给内容让位）；tabBar.tsx：浮动的 Tab 栏 / 宽屏的左侧导航栏
 * - sheet.tsx：浮起的面板（手机底部面板；平板换成居中对话框、贴按钮的菜单、右侧滑出）；menu.tsx：面板里的菜单
 * - overlay.tsx：浮条、长按菜单、useOverlay()；dialog.tsx：对话框
 *
 * 规则（数值在 theme/index.ts 开头）：浅灰的页面上放白底墨线的格子；只用硬投影；按下往投影方向挪 3、投影缩到 1；
 * 不能点的按钮变灰、没有投影；红 / 琥珀只表示出错 / 警告，并且一定配图标。
 */

export * from "./bars.tsx";
export * from "./buttons.tsx";
export * from "./controls.tsx";
export * from "./dialog.tsx";
export * from "./feedback.tsx";
export * from "./menu.tsx";
export * from "./overlay.tsx";
export * from "./primitives.tsx";
export * from "./rows.tsx";
export * from "./sheet.tsx";
export * from "./tabBar.tsx";
export { press } from "./press.ts";
export { Icon, type IconName } from "./icons.tsx";
