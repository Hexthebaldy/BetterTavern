/**
 * 换语言：三种语言各是一个页面（/、en/、ja/），换语言就是跳过去，带上当前的锚点。
 * 点过的语言记在浏览器里（STORED_LANG_KEY），以后打开中文首页时按它跳（scripts/head.ts 里的脚本）。
 * 宽屏在导航条右边是一个下拉（<details>，不开 JS 也能用）；窄屏在菜单最下面排成一行。
 */

import { useEffect, useRef, type MouseEvent } from "react";

import { Icon } from "../components/Icon.tsx";
import { useCopy, useLang } from "../i18n/context.tsx";
import { LANG_META, LANGS, STORED_LANG_KEY, langHref, type Lang } from "../i18n/langs.ts";

function pick(e: MouseEvent<HTMLAnchorElement>, to: Lang) {
  try {
    localStorage.setItem(STORED_LANG_KEY, to);
  } catch {
    // 浏览器不让存（隐私模式之类）：照样跳，只是下次不记得
  }
  const hash = window.location.hash;
  if (hash) {
    e.preventDefault();
    window.location.href = e.currentTarget.href.split("#")[0] + hash;
  }
}

function LangLink({ to, className }: { to: Lang; className?: string }) {
  const lang = useLang();
  const meta = LANG_META[to];
  return (
    <a
      className={className}
      href={langHref(lang, to)}
      hrefLang={meta.html}
      lang={meta.html}
      aria-current={to === lang ? "page" : undefined}
      onClick={(e) => pick(e, to)}
    >
      {meta.label}
      {to === lang && <Icon name="check" size="s" />}
    </a>
  );
}

/** 导航条上的下拉 */
export function LangMenu() {
  const lang = useLang();
  const copy = useCopy();
  const ref = useRef<HTMLDetailsElement>(null);

  // 点下拉外面或者按 Esc 收起来
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details className="lsw" ref={ref}>
      <summary aria-label={`${copy.nav.language}: ${LANG_META[lang].label}`}>
        <Icon name="globe" size="s" />
        <span>{LANG_META[lang].label}</span>
      </summary>
      <div className="lsw-m">
        {LANGS.map((l) => (
          <LangLink key={l} to={l} />
        ))}
      </div>
    </details>
  );
}

/** 菜单最下面的一行 */
export function LangRow() {
  const copy = useCopy();
  return (
    <div className="lsw-row" role="group" aria-label={copy.nav.language}>
      <Icon name="globe" size="s" />
      {LANGS.map((l) => (
        <LangLink key={l} to={l} />
      ))}
    </div>
  );
}
