/**
 * 07 常见问题：一次展开一条。第 6 条（长篇会不会前后矛盾）的说法以 docs/agent-runtime.md 为准，和设计稿不同。
 * 回答都在 HTML 里；不开 JS 时 index.html 里的样式把它们全部展开。
 */

import { useState, type ReactNode } from "react";

import { ISSUES } from "../data/links.ts";

const ITEMS: readonly { q: string; a: ReactNode }[] = [
  {
    q: "收费吗？",
    a: "不收费，BetterTavern 是开源项目。写故事用的是你自己的模型 Key，费用由模型服务商按用量收取。",
  },
  {
    q: "一定要自己运行服务器吗？",
    a: "是的，目前没有公共服务。故事、世界状态和 Key 都存在你自己运行的服务器上，一台常开的电脑或一台小云主机就够。",
  },
  {
    q: "手机 App 在哪里下载？",
    a: "还没有上架 App Store 和 Google Play。现在用 Expo Go 打开：在电脑上启动客户端（见上面部署里的“手机”），用手机扫终端里的二维码。手机和电脑要在同一个网络里，或者用 Tailscale 这类组网工具连起来。",
  },
  {
    q: "支持哪些角色卡？",
    a: "SillyTavern 的角色卡：PNG 图片或 JSON 文件，V1、V2、V3 都可以，最大 16 MB。PNG 卡的数据存在图片文件里，压缩过或截图得到的图片会丢掉这些数据，要用原文件。",
  },
  {
    q: "能用自己电脑上跑的模型吗？",
    a: (
      <>
        可以。添加模型时选“自定义兼容端点”，填上兼容 OpenAI 接口的地址。端点在本机或内网时，服务器要设置{" "}
        <code className="ic">ALLOW_PRIVATE_ENDPOINTS=true</code>。
      </>
    ),
  },
  {
    q: "长篇故事会不会前后矛盾？",
    a: "开局时 AI 先整理出世界状态，之后每写完一段，后台都按剧情更新它，下一段参照它来写。一场戏、一章结束时，前情整理成摘要；后台还维护一份大纲，导演写的时候对照；更早的细节，导演会去翻原文。写偏了，可以回到前面某一段重新选。",
  },
  {
    q: "支持哪些语言？",
    a: "界面有中文、英文和日文，在“设置 → 语言”里切换。故事正文不限定语言，一般跟着开局时的界面语言、角色卡和你写的话走。",
  },
  {
    q: "故事会被拿去训练模型吗？",
    a: "BetterTavern 不收集故事内容。写故事时，需要的前情会发给你选的模型服务商，他们怎么处理数据以各家的条款为准；介意的话，可以用自己电脑上跑的模型。",
  },
];

export function Faq() {
  // 一次展开一条；再点展开的那条就收起
  const [open, setOpen] = useState(0);
  return (
    <section className="sec" id="faq">
      <div className="wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "24px 64px" }}>
        <div className="shead" style={{ flex: "1 1 280px", margin: 0 }}>
          <span className="num">
            <b>07</b>
          </span>
          <h2 className="h-l">常见问题</h2>
          <p className="txt">
            其他问题可以在{" "}
            <a
              href={ISSUES}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--acc)", textUnderlineOffset: 3 }}
            >
              GitHub Issues
            </a>{" "}
            里提。
          </p>
        </div>
        <div className="faq" style={{ flex: "999 1 560px", minWidth: 0 }}>
          {ITEMS.map((item, i) => (
            <div key={i} className={open === i ? "faq-item open" : "faq-item"}>
              <h3 style={{ margin: 0 }}>
                <button
                  className="faq-q"
                  type="button"
                  aria-expanded={open === i}
                  aria-controls={`faq-a${i}`}
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <span>{item.q}</span>
                  <span className="plus" aria-hidden="true" />
                </button>
              </h3>
              <div className="faq-a" id={`faq-a${i}`}>
                <div>
                  <p>{item.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
