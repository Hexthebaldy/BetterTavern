/**
 * 界面部件（「白 / 柔线 / 大圆角」，设计稿见 docs/design/ui/）。页面只从这里 import。
 *
 * - primitives.tsx：页面容器、加载、文字、胶囊按钮、圆形图标按钮、分组卡、列表行、分区标题
 * - feedback.tsx：提示条、胶囊标签、状态、加载失败
 * - controls.tsx：输入框、分段、标签、勾选、单选、开关
 * - bars.tsx：一级页大标题、二级页导航栏、浮动的胶囊标签栏 / 宽屏的左侧导航栏（useTabBarSpace() 给内容让位）
 * - sheet.tsx：浮起的面板（手机底部面板；平板换成居中对话框、贴按钮的菜单、右侧滑出）和面板里的菜单
 * - overlay.tsx：墨色浮条、长按菜单、useOverlay()；dialog.tsx：对话框
 *
 * 层级靠“灰卡放在白底上”，不画外框；阴影只给浮起来的东西。状态靠换底色：选中黑底或浅蓝底加 2px 蓝色内描边，
 * 按下缩到 97%，禁用不透明度 0.3。圆角按 theme 里的阶梯（容器越大圆角越大），按钮和标签是全圆。
 * 红 / 绿 / 琥珀一定配图标。
 */

export * from "./bars.tsx";
export * from "./controls.tsx";
export * from "./dialog.tsx";
export * from "./feedback.tsx";
export * from "./overlay.tsx";
export * from "./primitives.tsx";
export * from "./sheet.tsx";
export { Icon, type IconName } from "./icons.tsx";
