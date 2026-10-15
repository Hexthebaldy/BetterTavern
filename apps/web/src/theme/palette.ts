/**
 * 把色板变成 CSS 变量：字段名转成短横线写法（accBg → --acc-bg，shadowFloat → --shadow-float）。
 * ThemeProvider 把它们写到 <html> 上；tokens.css 里同名的变量只是脚本加载前的兜底。
 */

import type { Palette } from "@bettertavern/design/palettes";

export function cssVarName(field: string): string {
  return `--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function paletteVars(palette: Palette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [field, value] of Object.entries(palette)) vars[cssVarName(field)] = value;
  return vars;
}
