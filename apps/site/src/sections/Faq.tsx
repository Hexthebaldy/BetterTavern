/**
 * 07 常见问题：一次展开一条。第 6 条（长篇会不会前后矛盾）的说法以 docs/agent-runtime.md 为准，和设计稿不同。
 * 回答都在 HTML 里；不开 JS 时 index.html 里的样式把它们全部展开。
 */

import { useState } from "react";

import { ISSUES } from "../data/links.ts";
import { useCopy } from "../i18n/context.tsx";
import { Rich } from "../i18n/rich.tsx";

export function Faq() {
  const { faq } = useCopy();
  // 一次展开一条；再点展开的那条就收起
  const [open, setOpen] = useState(0);
  return (
    <section className="sec" id="faq">
      <div className="wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "24px 64px" }}>
        <div className="shead" style={{ flex: "1 1 280px", margin: 0 }}>
          <span className="num">
            <b>07</b>
          </span>
          <h2 className="h-l">{faq.title}</h2>
          <p className="txt">
            {faq.more[0]}
            <a
              href={ISSUES}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--acc)", textUnderlineOffset: 3 }}
            >
              GitHub Issues
            </a>
            {faq.more[1]}
          </p>
        </div>
        <div className="faq" style={{ flex: "999 1 560px", minWidth: 0 }}>
          {faq.items.map((item, i) => (
            <div key={i} className={open === i ? "faq-item open" : "faq-item"}>
              <h3 style={{ margin: 0 }}>
                <button
                  className="faq-q"
                  type="button"
                  aria-expanded={open === i}
                  aria-controls={`faq-a${i}`}
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <span>{item.q}</span>
                  <span className="plus" aria-hidden="true" />
                </button>
              </h3>
              <div className="faq-a" id={`faq-a${i}`}>
                <div>
                  <p>
                    <Rich text={item.a} />
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
