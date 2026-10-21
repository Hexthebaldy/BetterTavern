/**
 * 当前页面的语言和文案：入口（main.tsx、entry-server.tsx）按页面地址选好一份，用 LangProvider 包住整页；
 * 组件里用 useCopy() 取文案。一个页面只有一种语言，换语言是跳到另一个页面。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Lang } from "./langs.ts";
import type { Copy } from "./types.ts";

const LangContext = createContext<{ lang: Lang; copy: Copy } | null>(null);

export function LangProvider({ lang, copy, children }: { lang: Lang; copy: Copy; children: ReactNode }) {
  const value = useMemo(() => ({ lang, copy }), [lang, copy]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

function useLangContext() {
  const value = useContext(LangContext);
  if (!value) throw new Error("useCopy / useLang 要在 LangProvider 里面用");
  return value;
}

export function useCopy(): Copy {
  return useLangContext().copy;
}

export function useLang(): Lang {
  return useLangContext().lang;
}
