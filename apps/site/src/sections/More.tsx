/**
 * 03 长篇：六张卡。摘要、大纲、回退的说法以 docs/agent-runtime.md 为准（和设计稿的原文不同）：
 * 摘要在一场戏、一章结束时整理，原文一直保留；大纲分拍，线索单独记；回退可以到任意一段，没有“重写当前这一段”，
 * 每个存档的回退次数有上限（服务端设置 ROLLBACK_LIMIT，默认 1）。
 */

import type { CSSProperties } from "react";

import { Icon } from "../components/Icon.tsx";

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
  return (
    <section className="sec" id="more">
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>03</b>
          </span>
          <h2 className="h-l">长篇</h2>
          <p className="lead">
            正文由导演模型写。世界状态、前情摘要和大纲由后台另外整理，不挡下一段；写每一段时，这些都放进上下文，更早的细节导演会去翻原文。
          </p>
        </div>
        <div className="grid3">
          <article className="card hov">
            <div className="vig sm" aria-hidden="true" style={{ flexDirection: "column", gap: 16 }}>
              <div className="dots">
                {DOTS.map((c, i) => (
                  <i key={i} className={c || undefined} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--ink2)" }}>
                <Legend swatch={{ background: "var(--ink)" }}>前情</Legend>
                <Legend swatch={{ background: "var(--acc)" }}>最近几段</Legend>
                <Legend swatch={{ boxShadow: "inset 0 0 0 2px var(--warn)" }}>从这里开始整理</Legend>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">前情摘要</h3>
              <p className="txt">
                一场戏、一章结束时，后台把前情整理成摘要和全书梗概。原文一直保留；人物和地点的状态另外保存，整理时不会丢。
              </p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="outline">
                {["灯为什么灭了", "老周去了哪里"].map((t) => (
                  <div className="ol ok" key={t}>
                    <span className="d">
                      <Icon name="check" style={{ width: 12, height: 12, strokeWidth: 2.4 }} />
                    </span>
                    {t}
                  </div>
                ))}
                <div className="ol now">
                  <span className="d" />
                  第二盏灯是谁点的
                  <span style={{ marginLeft: "auto", fontSize: 11.5 }}>进行中</span>
                </div>
                <div className="ol">
                  <span className="d" />
                  那条沉船
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">长程大纲</h3>
              <p className="txt">
                大纲把主线分成一拍一拍，写每一段时导演都看得到当前这一拍；剧情走偏了，后台会改大纲。还没收回的伏笔另外记在线索表里。
              </p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="tl">
                <div className="t here">
                  <Icon name="rewind" size="s" />
                  第 11 段<span className="ln" style={{ background: "rgba(47,85,244,.18)" }} />
                  从这里重新选
                </div>
                <div className="t gone">
                  第 12 段<span className="ln" />
                </div>
                <div className="t gone">
                  第 13 段<span className="ln" />
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">回退</h3>
              <p className="txt">
                回到前面的某一段重新选。世界状态、摘要和大纲都退回到那一段时的样子。每个存档能回退的次数有上限，默认 1 次。
              </p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="compose">
                <div className="box">
                  我把信塞回她手里，转身就走。
                  <span className="caret" />
                </div>
                <div className="row">
                  <span />
                  <span className="send">发送</span>
                </div>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">自己写</h3>
              <p className="txt">选项以外的行动，点“自己写”，用一句话告诉导演你要做什么。</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true" style={{ flexDirection: "column", gap: 10 }}>
              <div className="stat w">
                <span className="pd" />
                连接断了，正在重连…
              </div>
              <Icon name="arrowDown" style={{ color: "var(--mut)" }} />
              <div className="stat a">
                <span className="pulse" />
                已重连，继续生成
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">断线续写</h3>
              <p className="txt">网络断了，或者 App 切到后台，回来以后从断的地方接着写，不重复也不缺字。</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig sm" aria-hidden="true">
              <div className="theend">
                <Icon name="flag" size="l" style={{ color: "var(--mut)" }} />
                <span className="w">全文完</span>
                <span className="badge">写结局：让我亲手点亮那盏灯</span>
              </div>
            </div>
            <div className="body">
              <h3 className="h-m">写结局</h3>
              <p className="txt">在“更多”里点“写结局”，可以说明想要怎样的结局，AI 会写一大段收尾。</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
