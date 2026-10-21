/**
 * 03 长篇：agent runtime 架构图（Arc.tsx），下面六张卡。摘要、大纲、回退的说法以 docs/agent-runtime.md 为准，
 * 写在文案里（i18n/zh/index.ts 开头有说明）。
 */

import type { CSSProperties } from "react";

import { Icon } from "../components/Icon.tsx";
import { fill } from "../i18n/format.ts";
import { useCopy } from "../i18n/context.tsx";
import { Arc } from "./Arc.tsx";

/** 前情摘要卡上的点阵：墨色是整理过的前情，蓝色是最近几段，空心是还没写到的，带橙圈的是从这里开始整理 */
const DOTS: readonly ("" | "m" | "o" | "f")[] = [
  ...Array<"">(28).fill(""),
  "m",
  "",
  ...Array<"o">(6).fill("o"),
  ...Array<"f">(12).fill("f"),
];

function Legend({ swatch, children }: { swatch: CSSProperties; children: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <i style={{ width: 10, height: 10, borderRadius: 5, ...swatch }} />
      {children}
    </span>
  );
}

export function More() {
  const { more } = useCopy();
  return (
    <section className="sec" id="more">
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>03</b>
          </span>
          <h2 className="h-l">{more.title}</h2>
          <p className="lead">{more.lead}</p>
        </div>
        <Arc />
        <div className="grid3">
          <article className="card hov">
            <div className="vig sm" aria-hidden="true" style={{ flexDirection: "column", gap: 16 }}>
              <div className="dots">
                {DOTS.map((c, i) => (
                  <i key={i} className={c || undefined} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--ink2)" }}>
                <Legend swatch={{ background: "var(--ink)" }}>{more.recap.legend[0]}</Legend>
                <Legend swatch={{ background: "var(--acc)" }}>{more.recap.legend[1]}</Legend>
                <Legend swatch={{ boxShadow: "inset 0 0 0 2px var(--warn)" }}>{more.recap.legend[2]}</Legend>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.recap.title}</h3>
              <p className="txt">{more.recap.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="outline">
                {more.outline.done.map((t) => (
                  <div className="ol ok" key={t}>
                    <span className="d">
                      <Icon name="check" style={{ width: 12, height: 12, strokeWidth: 2.4 }} />
                    </span>
                    {t}
                  </div>
                ))}
                <div className="ol now">
                  <span className="d" />
                  {more.outline.now}
                  <span style={{ marginLeft: "auto", fontSize: 11.5 }}>{more.outline.nowTag}</span>
                </div>
                <div className="ol">
                  <span className="d" />
                  {more.outline.next}
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.outline.title}</h3>
              <p className="txt">{more.outline.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="tl">
                <div className="t here">
                  <Icon name="rewind" size="s" />
                  {fill(more.rollback.seg, { n: 11 })}
                  <span className="ln" style={{ background: "rgba(47,85,244,.18)" }} />
                  {more.rollback.here}
                </div>
                <div className="t gone">
                  {fill(more.rollback.seg, { n: 12 })}
                  <span className="ln" />
                </div>
                <div className="t gone">
                  {fill(more.rollback.seg, { n: 13 })}
                  <span className="ln" />
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.rollback.title}</h3>
              <p className="txt">{more.rollback.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="compose">
                <div className="box">
                  {more.write.sample}
                  <span className="caret" />
                </div>
                <div className="row">
                  <span />
                  <span className="send">{more.write.send}</span>
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.write.title}</h3>
              <p className="txt">{more.write.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true" style={{ flexDirection: "column", gap: 10 }}>
              <div className="stat w">
                <span className="pd" />
                {more.resume.lost}
              </div>
              <Icon name="arrowDown" style={{ color: "var(--mut)" }} />
              <div className="stat a">
                <span className="pulse" />
                {more.resume.back}
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.resume.title}</h3>
              <p className="txt">{more.resume.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="theend">
                <Icon name="flag" size="l" style={{ color: "var(--mut)" }} />
                <span className="w">{more.ending.end}</span>
                <span className="badge">{more.ending.wish}</span>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">{more.ending.title}</h3>
              <p className="txt">{more.ending.text}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
