/** 05 客户端：手机、平板、网页 */

import { Icon } from "../components/Icon.tsx";
import { DOCS, EXTERNAL } from "../data/links.ts";

export function Clients() {
  return (
    <section className="sec" id="clients" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>05</b>
          </span>
          <h2 className="h-l">客户端</h2>
          <p className="lead">
            手机、平板和网页客户端连同一台服务器，账号和故事通用。外观可以跟随系统，也可以固定成浅色或夜间；正文用宋体或黑体，字号可调。
          </p>
        </div>
        <div className="grid3">
          <article className="plat">
            <span className="icn">
              <Icon name="phone" size="l" />
            </span>
            <h3 className="h-m">手机</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              iOS 和 Android
            </p>
            <p className="txt">React Native（Expo），两个平台用同一套代码。还没有上架应用商店，目前用 Expo Go 打开。</p>
            <div className="acts">
              <a className="alink" href={DOCS.mobile} {...EXTERNAL}>
                手机端说明
                <Icon name="arrowOut" size="s" />
              </a>
            </div>
          </article>
          <article className="plat">
            <span className="icn">
              <Icon name="tablet" size="l" />
            </span>
            <h3 className="h-m">平板</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              iPad 和 Android 平板
            </p>
            <p className="txt">和手机是同一个 App。屏幕宽的时候正文居中排版，世界面板可以停靠在旁边。</p>
          </article>
          <article className="plat">
            <span className="icn">
              <Icon name="laptop" size="l" />
            </span>
            <h3 className="h-m">网页</h3>
            <p className="cap" style={{ marginTop: -10 }}>
              电脑浏览器
            </p>
            <p className="txt">
              有侧栏和键盘快捷键，角色卡文件可以直接拖进窗口导入。本地用 <code className="ic">make web</code> 启动。
            </p>
            <div className="acts">
              <a className="alink" href={DOCS.client} {...EXTERNAL}>
                网页端说明
                <Icon name="arrowOut" size="s" />
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
