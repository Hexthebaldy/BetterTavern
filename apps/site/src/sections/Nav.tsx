/**
 * 导航：标志、各节的锚点、文档、语言和“网页版”主按钮；窄于 900 时（英文、日文的字长一些，宽一点就收）
 * 锚点、文档、语言收进菜单（菜单里另有 GitHub），“网页版”一直留在右上角。
 * 一直有一道粗黑底线，往下滚以后线下再多一道蓝；当前所在的节垫一块斜切的蓝（scroll.ts）。
 */

import { useEffect, useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { DOCS, EXTERNAL, REPO, WEB_APP } from "../data/links.ts";
import { useCopy } from "../i18n/context.tsx";
import { DocNote } from "./DocNote.tsx";
import { LangMenu, LangRow } from "./LangSwitch.tsx";
import { currentSection, isScrolled, SECTION_IDS, type SectionId } from "./scroll.ts";

/** 导航条里列出的节；“客户端”只在菜单里 */
const NAV_LINKS: readonly SectionId[] = ["how", "world", "more", "models", "deploy", "faq"];

export function Nav() {
  const { nav, docsLangNote } = useCopy();
  const [current, setCurrent] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(isScrolled(window.scrollY));
      const tops = SECTION_IDS.flatMap((id) => {
        const el = document.getElementById(id);
        return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
      });
      setCurrent(currentSection(tops));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  return (
    <header className={scrolled || menuOpen ? "nav up" : "nav"}>
      <div className="wrap in">
        <a className="brand" href="#top" aria-label={nav.home}>
          <Logo size={32} sized />
          <span>BetterTavern</span>
        </a>
        <nav className="links" aria-label={nav.aria}>
          {NAV_LINKS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className={current === id ? "on" : undefined}
              aria-current={current === id ? "location" : undefined}
            >
              {nav.labels[id]}
            </a>
          ))}
        </nav>
        <div className="tools" style={{ marginLeft: "auto" }}>
          <a
            className="gh"
            href={DOCS.development}
            hrefLang="zh-CN"
            title={docsLangNote || undefined}
            {...EXTERNAL}
          >
            <Icon name="doc" size="s" />
            {nav.docs}
          </a>
          <LangMenu />
          {/* 右上角的主按钮原来是 GitHub，现在换成网页版；GitHub 在首屏、页脚和窄屏的菜单里 */}
          <a className="btn pri sm" href={WEB_APP} {...EXTERNAL}>
            {nav.webApp}
            <span className="arr">
              <Icon name="arrowOut" size="s" />
            </span>
          </a>
          <button
            className="ib menuBtn"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? nav.menuClose : nav.menuOpen}
            aria-expanded={menuOpen}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="drawer" aria-label={nav.aria}>
          {SECTION_IDS.map((id) => (
            <a key={id} href={`#${id}`} onClick={closeMenu}>
              {nav.labels[id]}
              <Icon name="chevron" size="s" />
            </a>
          ))}
          <a href={DOCS.development} hrefLang="zh-CN" {...EXTERNAL} onClick={closeMenu}>
            <span>
              {nav.docs}
              <DocNote />
            </span>
            <Icon name="arrowOut" size="s" />
          </a>
          <a href={REPO} {...EXTERNAL} onClick={closeMenu}>
            GitHub
            <Icon name="arrowOut" size="s" />
          </a>
          <LangRow />
        </nav>
      )}
    </header>
  );
}
