/** 三份文案放在一起：构建时预渲染三个页面（entry-server.tsx）和测试用；浏览器里按语言单独加载（load.ts） */

import { en } from "./en/index.ts";
import { ja } from "./ja/index.ts";
import type { Lang } from "./langs.ts";
import type { Copy } from "./types.ts";
import { zh } from "./zh/index.ts";

export const COPIES: Record<Lang, Copy> = { zh, en, ja };
