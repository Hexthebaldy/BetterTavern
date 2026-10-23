/**
 * 自己托管的字体（和落地页一样，不走 Google Fonts）：标题的思源宋体 900，标签、编号、键帽的 IBM Plex Mono 500 / 700。
 * @fontsource 的样式表按 unicode-range 切片，浏览器只下载页面上用到的片。
 * 宋体只托管 900：400 的宋体（旁白、台词、叙述）用系统宋体（tokens.css 的 --font-serif 不写 "Noto Serif SC"，
 * 否则同名的 900 会被拿去画 400 的字）。日文标题用系统的明朝体。
 */

import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
