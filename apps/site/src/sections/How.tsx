/** 01 开始一个故事：导入角色卡、给主角起名字、读一段选一个 */

import { useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { useCopy } from "../i18n/context.tsx";

/** 第一步卡片上的角色卡封面（灯塔和浪） */
function CardArt() {
  return (
    <svg viewBox="0 0 80 84" width="80" height="84" style={{ display: "block", width: "100%", height: "100%" }}>
      <path
        d="M-4 62q11-7 22 0t22 0 22 0 22 0"
        style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 2.2, strokeLinecap: "round" }}
      />
      <path
        d="M-4 72q11-7 22 0t22 0 22 0 22 0"
        style={{ fill: "none", stroke: "var(--line2)", strokeWidth: 2.2, strokeLinecap: "round" }}
      />
      <path d="M40 24l8 31H32z" style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 2.2, strokeLinejoin: "round" }} />
      <circle cx="40" cy="19" r="5" style={{ fill: "var(--acc)" }} />
    </svg>
  );
}

export function How() {
  const { how, story } = useCopy();
  const [ident, setIdent] = useState(1);
  return (
    <section className="sec" id="how">
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>01</b>
          </span>
          <h2 className="h-l">{how.title}</h2>
          <p className="lead">{how.lead}</p>
        </div>
        <div className="grid3">
          <article className="card hov">
            <div className="vig" aria-hidden="true">
              <div className="drop">
                <Icon name="upload" />
                <b>
                  <span className="rest">{how.s1.drag}</span>
                  <span className="hot">{how.s1.drop}</span>
                </b>
                <span>.PNG / .JSON · ≤ 16 MB</span>
              </div>
              <div className="cardpic">
                <div className="art">
                  <CardArt />
                </div>
                <span>{how.s1.file}</span>
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 1</span>
              <h3 className="h-m">{how.s1.title}</h3>
              <p className="txt">{how.s1.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig" style={{ flexDirection: "column", gap: 14 }}>
              <div className="namef" aria-hidden="true">
                <span className="lab">{how.s2.nameLabel}</span>
                <div className="fld">
                  {story.defaultName}
                  <span className="caret" />
                </div>
              </div>
              <div className="chips" style={{ width: "calc(100% - 40px)" }} role="radiogroup" aria-label={how.s2.identitiesAria}>
                {how.s2.identities.map((label, i) => (
                  <button
                    key={label}
                    className={ident === i ? "chipb on" : "chipb"}
                    type="button"
                    role="radio"
                    aria-checked={ident === i}
                    onClick={() => setIdent(i)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 2</span>
              <h3 className="h-m">{how.s2.title}</h3>
              <p className="txt">{how.s2.text}</p>
            </div>
          </article>
          <article className="card hov">
            <div
              className="vig"
              aria-hidden="true"
              style={{ flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 8, padding: "0 20px" }}
            >
              <span className="ln" style={{ width: "92%" }} />
              <span className="ln" style={{ width: "100%" }} />
              <span className="ln" style={{ width: "58%", marginBottom: 10 }} />
              <div className="opts">
                <div className="opt mini" style={{ cursor: "default" }}>
                  <span className="key">A</span>
                  <span>{story.options.root[0]}</span>
                </div>
                <div className="opt mini on" style={{ cursor: "default" }}>
                  <span className="key">B</span>
                  <span>{story.options.root[1]}</span>
                </div>
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 3</span>
              <h3 className="h-m">{how.s3.title}</h3>
              <p className="txt">{how.s3.text}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
