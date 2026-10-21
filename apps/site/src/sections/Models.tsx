/** 04 模型和数据：服务商和 Key；数据存在哪里 */

import { useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { ProviderMark } from "../components/ProviderMark.tsx";
import { EXTERNAL } from "../data/links.ts";
import { PROVIDERS } from "../data/providers.ts";
import { useCopy } from "../i18n/context.tsx";
import { fill } from "../i18n/format.ts";

export function Models() {
  const { models } = useCopy();
  const m = models.model;
  const [provId, setProvId] = useState(PROVIDERS[0]!.id);
  const prov = PROVIDERS.find((p) => p.id === provId) ?? PROVIDERS[0]!;
  const provName = prov.name ?? models.customName;
  return (
    <section className="sec" id="models" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>04</b>
          </span>
          <h2 className="h-l">{models.title}</h2>
        </div>
        <div className="grid2">
          <article className="panel">
            <h3 className="h-m">{m.title}</h3>
            <p className="txt">{m.text}</p>
            <div className="tiles" role="radiogroup" aria-label={m.providersAria}>
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
                  <span>{p.name ?? models.customName}</span>
                </button>
              ))}
            </div>
            <div className="keyrow">
              <div className="lab">
                <span>API Key</span>
                {prov.keyUrl ? (
                  <a href={prov.keyUrl} {...EXTERNAL}>
                    {fill(m.getKey, { name: provName })}
                    <Icon name="arrowOut" size="s" />
                  </a>
                ) : (
                  <span className="cap">{m.customHint}</span>
                )}
              </div>
              <div className="keyfld">
                <span className="ph">{prov.placeholder ?? models.customPlaceholder}</span>
                <span className="paste">
                  <Icon name="paste" size="s" />
                  {m.paste}
                </span>
              </div>
              <p className="cap" style={{ padding: "0 4px" }}>
                {m.keyNote}
                <span className="mono">•••• 3f9a</span>
              </p>
            </div>
          </article>
          <article className="panel">
            <h3 className="h-m">{models.data.title}</h3>
            <div className="flow">
              <div className="st">
                <span className="ics">
                  <Icon name="phone" />
                  <Icon name="monitor" />
                </span>
                <b>{models.data.flow[0].b}</b>
                <span>{models.data.flow[0].s}</span>
              </div>
              <span className="ar">
                <Icon name="arrowRight" />
              </span>
              <div className="st me">
                <span className="ics">
                  <Icon name="server" />
                </span>
                <b>{models.data.flow[1].b}</b>
                <span>{models.data.flow[1].s}</span>
              </div>
              <span className="ar">
                <Icon name="arrowRight" />
              </span>
              <div className="st">
                <span className="ics">
                  <Icon name="spark" />
                </span>
                <b>{models.data.flow[2].b}</b>
                <span>{models.data.flow[2].s}</span>
              </div>
            </div>
            <ul className="plist">
              <li>
                <span className="tic">
                  <Icon name="lock" size="s" />
                </span>
                <span>{models.data.list[0]}</span>
              </li>
              <li>
                <span className="tic">
                  <Icon name="send" size="s" />
                </span>
                <span>{models.data.list[1]}</span>
              </li>
              <li>
                <span className="tic">
                  <Icon name="eyeOff" size="s" />
                </span>
                <span>{models.data.list[2]}</span>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
