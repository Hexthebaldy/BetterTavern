/**
 * 线条图标（24 栅格，描边用当前文字颜色），形状照设计稿 docs/design/landing/source/*.dc.html 搬。
 * 默认 20px；size="s" 16px，size="l" 24px（样式表里的 .i、.i.s、.i.l）。图标都只是装饰，读屏跳过。
 */

import type { CSSProperties, ReactNode } from "react";

const PATHS = {
  arrowOut: <path d="M7 17L17 7M9 7h8v8" />,
  arrowRight: <path d="M5 12h13M13 6l6 6-6 6" />,
  arrowDown: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  doc: (
    <>
      <path d="M6.5 4.5h8l3 3v12h-11z" />
      <path d="M9.5 11h5M9.5 14.5h5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="3" />
      <path d="M11 18.5h2" />
    </>
  ),
  tablet: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M11 18h2" />
    </>
  ),
  laptop: (
    <>
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M2 19.5h20" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="5" width="19" height="12" rx="2" />
      <path d="M8 20.5h8" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>
  ),
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 14v3.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V14" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
    </>
  ),
  place: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  item: (
    <>
      <path d="M5 8.5l7-4 7 4v7l-7 4-7-4z" />
      <path d="M5 8.5l7 4 7-4M12 12.5v7" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.3 8.3l2.4 7.4M15.7 8.3l-2.4 7.4M8.5 7h7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="3" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </>
  ),
  rewind: <path d="M11 7L6 12l5 5M18 7l-5 5 5 5" />,
  flag: <path d="M6 21V4M6 4h10l-2 4 2 4H6" />,
  paste: (
    <>
      <rect x="7" y="4" width="10" height="4" rx="1.5" />
      <path d="M8 6H6.5A1.5 1.5 0 005 7.5v11A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5v-11A1.5 1.5 0 0017.5 6H16" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
      <path d="M15.5 8.5v-2a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2" />
    </>
  ),
  send: <path d="M4 12l16-7-7 16-2-7z" />,
  eyeOff: (
    <path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 01-3 3.9M6.6 6.6A16 16 0 002.5 12S6 18.5 12 18.5a9.5 9.5 0 004.4-1.1" />
  ),
  pencil: <path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z" />,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  restart: (
    <>
      <path d="M4 12a8 8 0 108-8 8.2 8.2 0 00-6.4 3.1" />
      <path d="M4.5 3.5v4.2h4.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size,
  style,
}: {
  name: IconName;
  size?: "s" | "l";
  style?: CSSProperties;
}) {
  return (
    <svg className={size ? `i ${size}` : "i"} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {PATHS[name]}
    </svg>
  );
}
