/**
 * 界面部件（UI v2「白 / 线 / 直角」，设计稿见 docs/design/ui-v2/）。页面只从这里 import。
 *
 * - primitives.tsx：页面容器、加载、文字、按钮、列表行、分区标题
 * - feedback.tsx：提示条、状态、小标签、加载失败
 * - controls.tsx：输入框、分段、标签、勾选、单选、开关
 * - bars.tsx：一级页大标题、二级页导航栏、标签栏
 * - overlay.tsx：底部面板、墨色浮条、useOverlay()；dialog.tsx：对话框
 *
 * 状态只靠三种手段表达：线的粗细（1px → 2px）、黑白反转、蓝色焦点。红 / 绿 / 琥珀一定配图标。所有圆角为 0。
 */

export * from "./bars.tsx";
export * from "./controls.tsx";
export * from "./dialog.tsx";
export * from "./feedback.tsx";
export * from "./overlay.tsx";
export * from "./primitives.tsx";
export { Icon, type IconName } from "./icons.tsx";
