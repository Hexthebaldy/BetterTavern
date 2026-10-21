/**
 * 落地页文案的结构：中文、英文、日文（i18n/zh、en、ja）各写一份，类型检查保证一份不缺。
 * 文字里一对反引号括起来的部分显示成行内代码（rich.tsx）；{name} 这类占位在用的地方替换（format.ts 的 fill）。
 * 演示故事和关系图的文字类型跟着各自的数据走：StoryText 在 demo/story.ts，WorldText 在 world/graph.ts。
 */

import type { ArcChip, ArcLink } from "../arc/steps.ts";
import type { DeployNote, DeployTabId } from "../data/deploy.ts";
import type { StoryText } from "../demo/story.ts";
import type { SectionId } from "../sections/scroll.ts";
import type { WorldText } from "../world/graph.ts";

type Eight<T> = readonly [T, T, T, T, T, T, T, T];
type Three<T> = readonly [T, T, T];

export type ArcText = {
  title: string;
  stepsAria: string;
  /** 八个状态：全景、1～6 步、回退。label 写在上面的标签上，title 和 text 写在说明条上 */
  steps: Eight<{ label: string; title: string; text: string }>;
  /** 全景时说明条左边的方块里写的字 */
  all: string;
  start: string;
  next: string;
  back: string;
  fgLane: string;
  bgLane: string;
  parts: {
    act: { t: string; d: string; write: string };
    ctx: { t: string; rows: readonly [string, string, string, string]; aria: string; d: string };
    dir: { t: string; d: string; model: string };
    out: { t: string; d: string; tools: Three<string> };
    st: { t: string; d: string; tools: string; queue: string };
    ch: { t: string; d: string; queue: string };
    ol: { t: string; d: string; queue: string };
  };
  links: Record<ArcLink, string>;
  db: { sub: string; chips: Record<ArcChip, string> };
};

export type Copy = {
  meta: { title: string };
  /** 找不到页面时的 404 页（scripts/seo.ts 把三种语言写在同一页上） */
  notFound: { title: string; text: string; home: string };
  nav: {
    labels: Record<SectionId, string>;
    home: string;
    aria: string;
    docs: string;
    menuOpen: string;
    menuClose: string;
    language: string;
  };
  /** 文档只有中文：英文和日文页上，指向文档的链接后面加这句说明；中文页是空的 */
  docsLangNote: string;
  /** 首屏。lead 也用作页面的 description */
  hero: {
    lead: string;
    status: string;
    /** 首屏的“下载 Android 版”按钮 */
    android: string;
    deploy: string;
    platforms: string;
    demoCap: string;
  };
  facts: { aria: string; items: readonly { k: string; v: string }[] };
  how: {
    title: string;
    lead: string;
    s1: { drag: string; drop: string; file: string; title: string; text: string };
    s2: { nameLabel: string; identities: Three<string>; identitiesAria: string; title: string; text: string };
    s3: { title: string; text: string };
  };
  world: {
    title: string;
    lead: string;
    ticks: Three<string>;
    secretCount: string;
    reveal: string;
    revealed: string;
    ask: string;
    cancel: string;
    capHover: string;
    capTouch: string;
    graphAria: string;
    graph: WorldText;
  };
  more: {
    title: string;
    lead: string;
    arc: ArcText;
    recap: { title: string; text: string; legend: Three<string> };
    outline: {
      title: string;
      text: string;
      done: readonly [string, string];
      now: string;
      nowTag: string;
      next: string;
    };
    /** seg 里的 {n} 是第几段 */
    rollback: { title: string; text: string; seg: string; here: string };
    write: { title: string; text: string; sample: string; send: string };
    resume: { title: string; text: string; lost: string; back: string };
    ending: { title: string; text: string; end: string; wish: string };
  };
  models: {
    title: string;
    model: {
      title: string;
      text: string;
      providersAria: string;
      /** {name} 是服务商 */
      getKey: string;
      customHint: string;
      paste: string;
      keyNote: string;
    };
    customName: string;
    customPlaceholder: string;
    data: { title: string; flow: Three<{ b: string; s: string }>; list: Three<string> };
  };
  clients: {
    title: string;
    lead: string;
    phone: { title: string; sub: string; text: string; link: string; download: string };
    tablet: { title: string; sub: string; text: string };
    web: { title: string; sub: string; text: string; link: string };
  };
  deploy: {
    title: string;
    lead: string;
    needTitle: string;
    needs: Three<{ k: string; v: string }>;
    note: string;
    devGuide: string;
    proxy: string;
    tabsAria: string;
    terminal: string;
    tabs: Record<DeployTabId, string>;
    notes: Record<DeployNote, string>;
    copy: string;
    copied: string;
    selectedMac: string;
    selectedOther: string;
  };
  faq: {
    title: string;
    /** “其他问题可以在 GitHub Issues 里提”：链接前后的字 */
    more: readonly [string, string];
    items: readonly { q: string; a: string }[];
  };
  footer: {
    about: readonly [string, string];
    project: string;
    issues: string;
    deploy: string;
    docs: string;
    devGuide: string;
    overview: string;
    uiDesign: string;
    clients: string;
    mobile: string;
    web: string;
    android: string;
    license: string;
  };
  /** 首屏演示的界面文字；故事本身在 story */
  demo: {
    /** {title} 是故事名 */
    aria: string;
    nameAria: string;
    namePlaceholder: string;
    /** {name} 是主角的名字 */
    me: string;
    meAria: string;
    toDark: string;
    toLight: string;
    restart: string;
    myAction: string;
    typedHint: string;
    optionsAria: string;
    /** {key} 是 A / B，{label} 是选项 */
    optionAria: string;
    endTitle: string;
    endText: string;
    world: string;
    worldFresh: string;
    worldClose: string;
    worldSub: string;
    worldFoot: string;
    showAll: string;
    writeOwn: string;
    composeAria: string;
    composePlaceholder: string;
    send: string;
    collapse: string;
    isNew: string;
    isUpd: string;
  };
  story: StoryText;
};
