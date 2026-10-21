/** 落地页：导航、首屏、一览，七节内容，页脚。各节的结构照设计稿 docs/design/landing/source/Landing.dc.html，文案在 i18n/ */

import { Nav } from "./sections/Nav.tsx";
import { Hero } from "./sections/Hero.tsx";
import { Facts } from "./sections/Facts.tsx";
import { How } from "./sections/How.tsx";
import { World } from "./sections/World.tsx";
import { More } from "./sections/More.tsx";
import { Models } from "./sections/Models.tsx";
import { Clients } from "./sections/Clients.tsx";
import { Deploy } from "./sections/Deploy.tsx";
import { Faq } from "./sections/Faq.tsx";
import { Footer } from "./sections/Footer.tsx";
import { useLang } from "./i18n/context.tsx";

export function App() {
  // 语言写进类名：英文、日文的字体和排版在样式表里按 .lp.en、.lp.ja 调
  const lang = useLang();
  return (
    <div className={`lp ${lang}`} id="top">
      <Nav />
      <main>
        <Hero />
        <Facts />
        <How />
        <World />
        <More />
        <Models />
        <Clients />
        <Deploy />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
