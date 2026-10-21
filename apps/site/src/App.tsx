/** 落地页：导航、首屏、一览，七节内容，页脚。各节的结构和文案照设计稿 docs/design/landing/source/Landing.dc.html */

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

export function App() {
  return (
    <div className="lp" id="top">
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
