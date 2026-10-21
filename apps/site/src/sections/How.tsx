/** 01 开始一个故事：导入角色卡、给主角起名字、读一段选一个 */

import { useState } from "react";

import { Icon } from "../components/Icon.tsx";

const IDENTITIES = ["过路的旅人", "新来的守夜人", "旧相识"];

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
  const [ident] = useState(1);
  return (
    <section className="sec" id="how">
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>01</b>
          </span>
          <h2 className="h-l">开始一个故事</h2>
          <p className="lead">需要一张角色卡和主角的名字，其他设置都可以留空。</p>
        </div>
        <div className="grid3">
          <article className="card hov">
            <div className="vig" aria-hidden="true">
              <div className="drop">
                <Icon name="upload" />
                <b>
                  <span className="rest">拖到这里</span>
                  <span className="hot">松开就导入</span>
                </b>
                <span>.PNG / .JSON · ≤ 16 MB</span>
              </div>
              <div className="cardpic">
                <div className="art">
                  <CardArt />
                </div>
                <span>雾港.png</span>
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 1</span>
              <h3 className="h-m">导入角色卡</h3>
              <p className="txt">
                支持 SillyTavern 的 V1、V2、V3 角色卡，PNG 或 JSON 文件。卡里的图片用作故事封面，世界书用来搭建开局的世界。
              </p>
            </div>
          </article>
          <article className="card hov">
            <div className="vig" style={{ flexDirection: "column", gap: 14 }}>
              <div className="namef" aria-hidden="true">
                <span className="lab">主角的名字</span>
                <div className="fld">
                  林深
                  <span className="caret" />
                </div>
              </div>
              <div className="chips" style={{ width: "calc(100% - 40px)" }} role="radiogroup" aria-label="身份（可选）">
                {IDENTITIES.map((label, i) => (
                  <button
                    key={label}
                    className={ident === i ? "chipb on" : "chipb"}
                    type="button"
                    role="radio"
                    aria-checked={ident === i}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 2</span>
              <h3 className="h-m">给主角起名字</h3>
              <p className="txt">
                名字必填。也可以选一个身份（过路的旅人、旧相识……），设定每段写多长、用什么文风。同一张卡可以开好几个故事。
              </p>
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
                  <span>先爬上灯塔，把灯点亮</span>
                </div>
                <div className="opt mini on" style={{ cursor: "default" }}>
                  <span className="key">B</span>
                  <span>回头去找那口钟</span>
                </div>
              </div>
            </div>
            <div className="body">
              <span className="num">STEP 3</span>
              <h3 className="h-m">读一段，选一个</h3>
              <p className="txt">AI 用第一人称写下一段，结尾给两个选项。点一个继续；想做别的，点“自己写”。</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
