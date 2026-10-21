/** 04 模型和数据：服务商和 Key；数据存在哪里 */

import { useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { ProviderMark } from "../components/ProviderMark.tsx";
import { EXTERNAL } from "../data/links.ts";
import { PROVIDERS } from "../data/providers.ts";

export function Models() {
  const [provId, setProvId] = useState(PROVIDERS[0]!.id);
  const prov = PROVIDERS.find((p) => p.id === provId) ?? PROVIDERS[0]!;
  return (
    <section className="sec" id="models" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>04</b>
          </span>
          <h2 className="h-l">模型和数据</h2>
        </div>
        <div className="grid2">
          <article className="panel">
            <h3 className="h-m">模型</h3>
            <p className="txt">
              在“设置 → 模型”里添加：选服务商，贴上 API Key，模型列表会自动出来。可以添加好几个，点一下就能换一个来写故事。费用由模型服务商按用量收取。
            </p>
            <div className="tiles" role="radiogroup" aria-label="服务商">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className={p.id === prov.id ? "tile on" : "tile"}
                  type="button"
                  role="radio"
                  aria-checked={p.id === prov.id}
                  onClick={() => setProvId(p.id)}
                >
                  <ProviderMark provider={p.id} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
            <div className="keyrow">
              <div className="lab">
                <span>API Key</span>
                {prov.keyUrl ? (
                  <a href={prov.keyUrl} {...EXTERNAL}>
                    去 {prov.name} 获取 Key
                    <Icon name="arrowOut" size="s" />
                  </a>
                ) : (
                  <span className="cap">另外填一个端点地址，比如自己电脑上跑的模型</span>
                )}
              </div>
              <div className="keyfld">
                <span className="ph">{prov.placeholder}</span>
                <span className="paste">
                  <Icon name="paste" size="s" />
                  粘贴
                </span>
              </div>
              <p className="cap" style={{ padding: "0 4px" }}>
                Key 加密保存，之后只显示后四位：<span className="mono">•••• 3f9a</span>
              </p>
            </div>
          </article>
          <article className="panel">
            <h3 className="h-m">数据存在哪里</h3>
            <div className="flow">
              <div className="st">
                <span className="ics">
                  <Icon name="phone" />
                  <Icon name="monitor" />
                </span>
                <b>客户端</b>
                <span>手机、平板、网页</span>
              </div>
              <span className="ar">
                <Icon name="arrowRight" />
              </span>
              <div className="st me">
                <span className="ics">
                  <Icon name="server" />
                </span>
                <b>你的服务器</b>
                <span>故事、世界状态、加密的 Key</span>
              </div>
              <span className="ar">
                <Icon name="arrowRight" />
              </span>
              <div className="st">
                <span className="ics">
                  <Icon name="spark" />
                </span>
                <b>模型服务商</b>
                <span>只收到写这一段需要的前情</span>
              </div>
            </div>
            <ul className="plist">
              <li>
                <span className="tic">
                  <Icon name="lock" size="s" />
                </span>
                <span>故事、世界设定、模型 Key 都保存在你自己运行的服务器上。Key 加密保存，App 里只显示后四位。</span>
              </li>
              <li>
                <span className="tic">
                  <Icon name="send" size="s" />
                </span>
                <span>只有在写故事的时候，服务器才把需要的前情发给你选的模型服务。</span>
              </li>
              <li>
                <span className="tic">
                  <Icon name="eyeOff" size="s" />
                </span>
                <span>服务器的运行日志不记录故事内容，也不记录 Key。</span>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
