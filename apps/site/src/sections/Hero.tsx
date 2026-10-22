/** 首屏：招牌、一句话介绍、现状，打开网页版的主按钮；右边是演示 */

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { androidApkHref, EXTERNAL, REPO, WEB_APP } from "../data/links.ts";
import { Demo } from "../demo/Demo.tsx";
import { useCopy, useLang } from "../i18n/context.tsx";

export function Hero() {
  const { hero } = useCopy();
  const lang = useLang();
  return (
    <section className="hero">
      <div className="wrap grid">
        <div className="copy">
          {/* 这一层和招牌一样宽，下面两段说明按招牌的宽度折行，左右和招牌对齐 */}
          <div className="intro">
            {/* 悬停由外面这一层接：它不动，牌子在里面抬起来，
                鼠标就不会因为牌子移开而反复进出 */}
            <div className="plateHit in1">
              <div className="plate">
                {/* 招牌里的标志约 54px 宽；窄屏上变小，样式表再把线加粗一档 */}
                <Logo size={54} className="mk" />
                <h1 className="h-xl reg">BetterTavern</h1>
              </div>
            </div>
            <p className="lead in2">{hero.lead}</p>
            <p className="txt in3">{hero.status}</p>
          </div>
          <div className="ctas in4">
            {/* 官方部署的网页版：打开就能注册使用 */}
            <a className="btn pri" href={WEB_APP} {...EXTERNAL}>
              {hero.web}
              <span className="arr">
                <Icon name="arrowOut" />
              </span>
            </a>
            <a className="btn sec" href={androidApkHref(lang)} download="BetterTavern.apk">
              <Icon name="android" />
              {hero.android}
            </a>
            <a className="btn sec" href={REPO} {...EXTERNAL}>
              GitHub
              <Icon name="arrowOut" />
            </a>
          </div>
          <div className="meta in4">
            <span>
              <Icon name="phone" size="s" />
              {hero.platforms}
            </span>
          </div>
        </div>
        <div className="demoCol in5">
          <Demo />
          <p className="cap" style={{ padding: "0 6px" }}>
            {hero.demoCap}
          </p>
        </div>
      </div>
    </section>
  );
}
