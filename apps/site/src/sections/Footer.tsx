/** 页脚：链接、超大字标、许可证 */

import { Logo } from "../components/Logo.tsx";
import { DOCS, EXTERNAL, ISSUES, REPO } from "../data/links.ts";

const COLUMNS = [
  {
    title: "项目",
    links: [
      { label: "GitHub", href: REPO },
      { label: "反馈问题", href: ISSUES },
      { label: "部署", href: "#deploy" },
    ],
  },
  {
    title: "文档",
    links: [
      { label: "开发者指南", href: DOCS.development },
      { label: "技术方案", href: DOCS.overview },
      { label: "界面设计", href: DOCS.uiDesign },
    ],
  },
  {
    title: "客户端",
    links: [
      { label: "手机端说明", href: DOCS.mobile },
      { label: "网页端说明", href: DOCS.client },
    ],
  },
];

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="cols">
          <div className="about" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
            <a className="brand" href="#top" aria-label="BetterTavern，回到顶部">
              <Logo size={28} sized />
              <span>BetterTavern</span>
            </a>
            <p className="txt">
              用 SillyTavern 角色卡玩的互动小说。
              <br />
              开源，需要自己部署。
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a className="flink" href={l.href} {...(l.href.startsWith("#") ? {} : EXTERNAL)}>
                      {l.label}
                    </a>
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
          <span>© 2026 BetterTavern · 许可证待定（MIT 或 Apache-2.0）</span>
        </div>
      </div>
    </footer>
  );
}
