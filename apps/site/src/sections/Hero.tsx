/** 首屏：招牌、一句话介绍、现状；右边是演示 */

import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { EXTERNAL, REPO } from "../data/links.ts";
import { Demo } from "../demo/Demo.tsx";

/** 首屏那句介绍，也用作页面的 description */
export const LEAD =
  "用 SillyTavern 角色卡玩的互动小说。AI 用第一人称写一段故事，结尾给两个选项；想做选项之外的事，可以自己写一句。";

export function Hero() {
  return (
    <section className="hero">
      <div className="wrap grid">
        <div className="copy">
          <p className="eyebrow in1">
            <i />
            开源项目 · 开发中
          </p>
          <div className="plate in2">
            {/* 招牌里的标志约 54px 宽；窄屏上变小，样式表再把线加粗一档 */}
            <Logo size={54} className="mk" />
            <h1 className="h-xl reg">BetterTavern</h1>
          </div>
          <p className="lead in3" style={{ maxWidth: "31em" }}>
            {LEAD}
          </p>
          <p className="txt in3" style={{ maxWidth: "34em" }}>
            目前需要自己运行服务器。手机 App 还没有上架应用商店，用 Expo Go 打开；网页版在本地启动。
          </p>
          <div className="ctas in4">
            <a className="btn pri" href={REPO} {...EXTERNAL}>
              GitHub
              <span className="arr">
                <Icon name="arrowOut" />
              </span>
            </a>
            <a className="btn sec" href="#deploy">
              部署说明
            </a>
          </div>
          <div className="meta in4">
            <span>
              <Icon name="phone" size="s" />
              iOS · Android · 平板 · 网页
            </span>
          </div>
        </div>
        <div className="demoCol in5">
          <div className="demoHead">
            <span className="eyebrow">演示 · 段落是预先写好的</span>
          </div>
          <Demo />
          <p className="cap" style={{ padding: "0 6px" }}>
            点选项往下读，也可以改主角的名字、切换夜间模式、打开世界状态。实际使用时，每一段由你配置的模型生成。
          </p>
        </div>
      </div>
    </section>
  );
}
