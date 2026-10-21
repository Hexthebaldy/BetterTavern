/**
 * 导航：标志、各节的锚点、文档和 GitHub；窄于 900 时收进菜单。
 * 一直有一道粗黑底线，往下滚以后线下再多一道蓝；当前所在的节垫一块斜切的蓝（scroll.ts）。
 */

import { useEffect, useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { DOCS, EXTERNAL, REPO } from "../data/links.ts";
import { currentSection, isScrolled, SECTION_IDS } from "./scroll.ts";

/** 导航里列出的节（“客户端”只在菜单里） */
export const NAV_LINKS = [
  { id: "how", label: "开始" },
  { id: "world", label: "世界状态" },
  { id: "more", label: "长篇" },
  { id: "models", label: "模型和数据" },
  { id: "deploy", label: "部署" },
  { id: "faq", label: "常见问题" },
] as const;

const MENU_LINKS = [
  { id: "how", label: "开始" },
  { id: "world", label: "世界状态" },
  { id: "more", label: "长篇" },
  { id: "models", label: "模型和数据" },
  { id: "clients", label: "客户端" },
  { id: "deploy", label: "部署" },
  { id: "faq", label: "常见问题" },
] as const;

export function Nav() {
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
        <a className="brand" href="#top" aria-label="BetterTavern，回到顶部">
          <Logo size={32} sized />
          <span>BetterTavern</span>
        </a>
        <nav className="links" aria-label="页面导航">
          {NAV_LINKS.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              className={current === l.id ? "on" : undefined}
              aria-current={current === l.id ? "location" : undefined}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="tools" style={{ marginLeft: "auto" }}>
          <a className="gh" href={DOCS.development} {...EXTERNAL}>
            <Icon name="doc" size="s" />
            文档
          </a>
          <a className="btn pri sm" href={REPO} {...EXTERNAL}>
            GitHub
            <span className="arr">
              <Icon name="arrowOut" size="s" />
            </span>
          </a>
          <button
            className="ib menuBtn"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "收起菜单" : "打开菜单"}
            aria-expanded={menuOpen}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="drawer" aria-label="页面导航">
          {MENU_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={closeMenu}>
              {l.label}
              <Icon name="chevron" size="s" />
            </a>
          ))}
          <a href={DOCS.development} {...EXTERNAL} onClick={closeMenu}>
            文档
            <Icon name="arrowOut" size="s" />
          </a>
        </nav>
      )}
    </header>
  );
}
