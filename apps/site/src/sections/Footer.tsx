/** 页脚：链接、超大字标、许可证 */

import { Logo } from "../components/Logo.tsx";
import { androidApkHref, DOCS, EXTERNAL, ISSUES, REPO } from "../data/links.ts";
import { useCopy, useLang } from "../i18n/context.tsx";
import { DocNote } from "./DocNote.tsx";

export function Footer() {
  const { footer: f, nav } = useCopy();
  const lang = useLang();
  // doc：指向仓库里的文档（只有中文）
  const columns = [
    {
      title: f.project,
      links: [
        { label: "GitHub", href: REPO },
        { label: f.issues, href: ISSUES },
        { label: f.deploy, href: "#deploy" },
      ],
    },
    {
      title: f.docs,
      links: [
        { label: f.devGuide, href: DOCS.development, doc: true },
        { label: f.overview, href: DOCS.overview, doc: true },
        { label: f.uiDesign, href: DOCS.uiDesign, doc: true },
      ],
    },
    {
      title: f.clients,
      links: [
        { label: f.android, href: androidApkHref(lang), download: true },
        { label: f.mobile, href: DOCS.mobile, doc: true },
        { label: f.web, href: DOCS.client, doc: true },
      ],
    },
  ];
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="cols">
          <div className="about" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
            <a className="brand" href="#top" aria-label={nav.home}>
              <Logo size={28} sized />
              <span>BetterTavern</span>
            </a>
            <p className="txt">
              {f.about[0]}
              <br />
              {f.about[1]}
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      className="flink"
                      href={l.href}
                      hrefLang={"doc" in l ? "zh-CN" : undefined}
                      download={"download" in l ? "BetterTavern.apk" : undefined}
                      {...(l.href.startsWith("http") ? EXTERNAL : {})}
                    >
                      {l.label}
                    </a>
                    {"doc" in l && <DocNote />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mast" aria-hidden="true" style={{ fontSize: "min(12.7vw, 182px)" }}>
          BetterTavern
        </div>
        <div className="base">
          <span>© 2026 BetterTavern · {f.license}</span>
        </div>
      </div>
    </footer>
  );
}
