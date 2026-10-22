/** 05 客户端：手机、平板、网页 */

import { Icon } from "../components/Icon.tsx";
import { androidApkHref, DOCS, EXTERNAL, WEB_APP } from "../data/links.ts";
import { useCopy, useLang } from "../i18n/context.tsx";
import { Rich } from "../i18n/rich.tsx";
import { DocNote } from "./DocNote.tsx";

export function Clients() {
  const { clients } = useCopy();
  const lang = useLang();
  return (
    <section className="sec" id="clients" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>05</b>
          </span>
          <h2 className="h-l">{clients.title}</h2>
          <p className="lead">{clients.lead}</p>
        </div>
        <div className="grid3">
          <article className="plat">
            <span className="icn">
              <Icon name="phone" size="l" />
            </span>
            <h3 className="h-m">{clients.phone.title}</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              {clients.phone.sub}
            </p>
            <p className="txt">{clients.phone.text}</p>
            <div className="acts">
              <a className="alink" href={androidApkHref(lang)} download="BetterTavern.apk">
                <Icon name="android" size="s" />
                {clients.phone.download}
              </a>
              <a className="alink" href={DOCS.mobile} hrefLang="zh-CN" {...EXTERNAL}>
                {clients.phone.link}
                <DocNote />
                <Icon name="arrowOut" size="s" />
              </a>
            </div>
          </article>
          <article className="plat">
            <span className="icn">
              <Icon name="tablet" size="l" />
            </span>
            <h3 className="h-m">{clients.tablet.title}</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              {clients.tablet.sub}
            </p>
            <p className="txt">{clients.tablet.text}</p>
          </article>
          <article className="plat">
            <span className="icn">
              <Icon name="laptop" size="l" />
            </span>
            <h3 className="h-m">{clients.web.title}</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              {clients.web.sub}
            </p>
            <p className="txt">
              <Rich text={clients.web.text} />
            </p>
            <div className="acts">
              <a className="alink" href={WEB_APP} {...EXTERNAL}>
                {clients.web.open}
                <Icon name="arrowOut" size="s" />
              </a>
              <a className="alink" href={DOCS.client} hrefLang="zh-CN" {...EXTERNAL}>
                {clients.web.link}
                <DocNote />
                <Icon name="arrowOut" size="s" />
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
