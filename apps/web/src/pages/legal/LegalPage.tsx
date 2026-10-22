/**
 * 用户协议、隐私政策、内容规则（/terms、/privacy、/rules）：登录前后都能打开，注册页和设置里有链接，App 用浏览器打开。
 * 正文是 content/<语言>/<页面>.md，按当前界面语言按需加载（不进首屏的包）；上面一排在三篇之间切换。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";

import { currentLanguage } from "@bettertavern/core/i18n/index";

import { cx, Dots, Notice } from "../../components/controls.tsx";
import { Logo } from "../../components/Logo.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import styles from "./legal.module.css";
import { documentTitle, Markdown } from "./markdown.tsx";

export type LegalDoc = "terms" | "privacy" | "rules";

const SOURCES = import.meta.glob<string>("./content/*/*.md", { query: "?raw", import: "default" });

function useSource(doc: LegalDoc, language: string): { text: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; text: string | null; failed: boolean }>({
    key: "",
    text: null,
    failed: false,
  });
  const key = `./content/${language}/${doc}.md`;
  useEffect(() => {
    let live = true;
    const load = SOURCES[key] ?? SOURCES[`./content/zh/${doc}.md`];
    if (!load) return;
    load()
      .then((text) => live && setState({ key, text, failed: false }))
      .catch(() => live && setState({ key, text: null, failed: true }));
    return () => {
      live = false;
    };
  }, [key, doc]);
  return state.key === key ? state : { text: null, failed: false };
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t } = useTranslation();
  const { text, failed } = useSource(doc, currentLanguage());
  useDocumentTitle(text ? documentTitle(text) : t(`legal.${doc}`));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <Logo size={32} label={null} />
          <span>BetterTavern</span>
        </Link>
        <nav className={styles.tabs} aria-label={t("legal.nav")}>
          {(["terms", "privacy", "rules"] as const).map((name) => (
            <NavLink key={name} to={`/${name}`} className={({ isActive }) => cx(styles.tab, isActive && styles.active)}>
              {t(`legal.${name}`)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={styles.body}>
        {failed ? <Notice message={t("legal.loadFailed")} /> : null}
        {text ? <Markdown source={text} /> : failed ? null : <Dots label={t("common.loading")} />}
      </main>
    </div>
  );
}
