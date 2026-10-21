/** 导航：标志、各节的锚点、文档和 GitHub；窄于 900 时收进菜单 */

import { useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { DOCS, EXTERNAL, REPO } from "../data/links.ts";

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
  const [current] = useState("");
  const [menuOpen] = useState(false);
  return (
    <header className="nav">
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
          <button className="ib menuBtn" type="button" aria-label="打开菜单" aria-expanded={menuOpen}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="drawer" aria-label="页面导航">
          {MENU_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`}>
              {l.label}
              <Icon name="chevron" size="s" />
            </a>
          ))}
          <a href={DOCS.development} {...EXTERNAL}>
            文档
            <Icon name="arrowOut" size="s" />
          </a>
        </nav>
      )}
    </header>
  );
}
