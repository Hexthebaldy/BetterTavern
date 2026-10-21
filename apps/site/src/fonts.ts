/**
 * 自己托管的字体（不走 Google Fonts，国内访问不稳定）：标题的思源宋体 600 / 700 / 900，标签和命令的 IBM Plex Mono 400 / 500 / 700。
 * @fontsource 的样式表按 unicode-range 切片，浏览器只下载页面上用到的片；构建时再去掉一个字都用不上的片（scripts/fontFaces.ts）。
 * 正文黑体用系统字体，和网页端一样；400 的宋体用系统宋体（样式表里的 --font-text-serif）。
 */

import "@fontsource/noto-serif-sc/600.css";
import "@fontsource/noto-serif-sc/700.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
