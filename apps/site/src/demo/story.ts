/**
 * 首屏演示：预先写好的一棵小故事树（两轮选项后结束）和它的推进规则，照设计稿 LandingDemo.dc.html 搬。
 * 故事的文字三种语言各一份（StoryText，在 i18n/<语言>/story.ts），状态里带着这一页的那份。
 * 这里只有数据和纯函数，计时器在 Demo.tsx 里。测试见 story.test.ts。
 *
 * 推进：begin 进入一段（先“构思”，再逐字写出）→ tick 每次多显示几个字 → 写完（finish）出现选项，
 * 世界里加上这一段出现的条目 → choose 选一个 → advance 把这一段记进前文，进入下一段。
 * 预渲染和 hydrate 时第一段直接是写完的样子（initialState），不重新逐字打一遍。
 */

export type NodeId = "root" | "a" | "b" | "aa" | "ab" | "ba" | "bb";
export type EntityId =
  | "me"
  | "pier"
  | "tower"
  | "keeper"
  | "bell"
  | "grey"
  | "log"
  | "ship"
  | "voice"
  | "chao"
  | "f_light"
  | "f_bell"
  | "f_steps";

/** 一段的结构：选项各通向哪一段、写完以后世界里有什么变化；文字在各语言的文案里（StoryText） */
export type StoryNode = {
  /** 两个选项各通向哪一段；没有就是结尾 */
  next?: readonly [NodeId, NodeId];
  /** 写完这一段，世界里新出现的条目 */
  adds?: readonly EntityId[];
  /** 不再单独列出的条目（“舱门后的人”原来是阿潮） */
  drops?: readonly EntityId[];
  /** 标成“更新”的条目 */
  upd?: readonly EntityId[];
};

export const STORY: Record<NodeId, StoryNode> = {
  root: { next: ["a", "b"], adds: ["me", "pier", "tower", "keeper", "bell"] },
  a: { next: ["aa", "ab"], adds: ["grey", "log"] },
  b: { next: ["ba", "bb"], adds: ["ship", "voice"] },
  aa: { adds: ["f_light"] },
  ab: { adds: ["f_bell"] },
  ba: { adds: ["chao"], drops: ["voice"], upd: ["chao"] },
  bb: { adds: ["f_steps"] },
};

/** 有选项的段 */
export type ChoiceNode = "root" | "a" | "b";

export type EntityKind = "person" | "place" | "item" | "fact";

export const ENTITY_KINDS: Record<EntityId, EntityKind> = {
  me: "person",
  pier: "place",
  tower: "place",
  keeper: "person",
  bell: "item",
  grey: "person",
  log: "item",
  ship: "place",
  voice: "person",
  chao: "person",
  f_light: "fact",
  f_bell: "fact",
  f_steps: "fact",
};

/** 演示故事的文字，三种语言各一份 */
export type StoryText = {
  /** 故事名，也是演示组件的标题 */
  title: string;
  /** 默认的主角名字 */
  defaultName: string;
  /** 名字最多几个字符 */
  nameMax: number;
  /** 逐字出现时每一拍多显示几个字符（拉丁字母比汉字多） */
  tickChars: number;
  /** 每一段的正文；{n} 换成主角的名字 */
  text: Record<NodeId, string>;
  options: Record<ChoiceNode, readonly [string, string]>;
  /** 世界里的条目；名字里的 {n} 换成主角的名字 */
  entities: Record<EntityId, { name: string; note: string }>;
  kinds: Record<EntityKind, string>;
  /** 世界面板里主角那一行写的类别 */
  me: string;
  /** 底部状态栏的字 */
  thinking: string;
  writingOpening: string;
  writingNext: string;
};

/** “自己写”最多几个字 */
export const DRAFT_MAX = 200;
/** 逐字出现的间隔、开始写之前“构思”多久、点了选项以后多久进入下一段（毫秒） */
export const TIMING = { tick: 42, thinkFirst: 900, think: 650, afterPick: 260 } as const;

export type Phase = "thinking" | "writing" | "idle";

export type DemoState = {
  /** 这一页的语言的故事文字；一个页面只有一种语言，开始以后不变 */
  story: StoryText;
  name: string;
  /** 前面已经读完的段落和当时选的选项 */
  steps: readonly { node: NodeId; pick: number }[];
  node: NodeId;
  phase: Phase;
  /** 当前这一段显示了几个字 */
  shown: number;
  /** 刚点的选项，等进入下一段 */
  chosen: number | null;
  /** 世界里已经出现的条目，按出现的顺序 */
  found: readonly EntityId[];
  /** 还没在世界面板里看过的新条目（世界按钮上的小蓝点） */
  fresh: readonly EntityId[];
  upd: readonly EntityId[];
  /** “自己写”发出去的一句 */
  typed: string;
  /** 写完一段时交给读屏念的全文 */
  live: string;
};

/** 把 {n} 换成主角的名字 */
export function fillName(text: string, name: string): string {
  return text.replace(/\{n\}/g, name);
}

export function fullText(story: StoryText, node: NodeId, name: string): string {
  return fillName(story.text[node], name);
}

/** 一段的两个选项：[文字, 通向哪一段]；结尾没有 */
export function optionsOf(story: StoryText, node: NodeId): { label: string; next: NodeId }[] | null {
  const next = STORY[node].next;
  if (!next) return null;
  const labels = story.options[node as ChoiceNode];
  return next.map((n, i) => ({ label: labels[i]!, next: n }));
}

/** 写完一段：显示全文，出现选项，世界里加上这一段的条目 */
export function finish(s: DemoState): DemoState {
  const st = STORY[s.node];
  const drops = st.drops ?? [];
  let found = s.found.filter((id) => !drops.includes(id));
  let fresh = s.fresh.filter((id) => !drops.includes(id));
  for (const id of st.adds ?? []) {
    if (!found.includes(id)) found = [...found, id];
    if (!fresh.includes(id)) fresh = [...fresh, id];
  }
  const text = fullText(s.story, s.node, s.name);
  return { ...s, phase: "idle", shown: text.length, live: text, found, fresh, upd: [...s.upd, ...(st.upd ?? [])] };
}

function empty(story: StoryText, name: string): DemoState {
  return {
    story,
    name,
    steps: [],
    node: "root",
    phase: "idle",
    shown: 0,
    chosen: null,
    found: [],
    fresh: [],
    upd: [],
    typed: "",
    live: "",
  };
}

/** 预渲染和 hydrate 时的样子：第一段已经写完，两个选项在下面 */
export function initialState(story: StoryText, name: string = story.defaultName): DemoState {
  // 页面刚打开时不让读屏把第一段再念一遍：它就在页面上
  return { ...finish(empty(story, name)), live: "" };
}

/** 进入一段。reduce（系统打开了“减少动态效果”）时直接显示全文 */
export function begin(s: DemoState, node: NodeId, reduce: boolean): DemoState {
  const next: DemoState = { ...s, node, phase: "thinking", shown: 0, chosen: null, live: "" };
  return reduce ? finish(next) : next;
}

/** “构思”结束，开始逐字写 */
export function startWriting(s: DemoState): DemoState {
  return s.phase === "thinking" ? { ...s, phase: "writing" } : s;
}

/** 多显示几个字（默认按这种语言的 tickChars）；到头就算写完 */
export function tick(s: DemoState, chars: number = s.story.tickChars): DemoState {
  if (s.phase !== "writing") return s;
  const shown = s.shown + chars;
  return shown >= fullText(s.story, s.node, s.name).length ? finish(s) : { ...s, shown };
}

/** “全部显示”：跳过逐字 */
export function skip(s: DemoState): DemoState {
  return s.phase === "idle" ? s : finish(s);
}

/** 点一个选项。还在写、已经点过、或者没有这个选项时不变 */
export function choose(s: DemoState, i: number): DemoState {
  if (s.phase !== "idle" || s.chosen !== null) return s;
  if (!STORY[s.node].next?.[i]) return s;
  return { ...s, chosen: i };
}

/** 点过选项以后：这一段记进前文，进入下一段；“自己写”的那一句清掉 */
export function advance(s: DemoState, reduce: boolean): DemoState {
  if (s.chosen === null) return s;
  const next = STORY[s.node].next?.[s.chosen];
  if (!next) return s;
  return begin({ ...s, steps: [...s.steps, { node: s.node, pick: s.chosen }], typed: "" }, next, reduce);
}

/** 从头再读：保留名字，其余回到开头，第一段重新逐字写 */
export function restart(s: DemoState, reduce: boolean): DemoState {
  return begin(empty(s.story, s.name), "root", reduce);
}

export function isEnded(s: DemoState): boolean {
  return s.phase === "idle" && !STORY[s.node].next;
}

/** 输入框里的名字：最多 nameMax 个字符 */
export function clampName(story: StoryText, input: string): string {
  return input.slice(0, story.nameMax);
}

/** 改名字：去掉首尾空白；空的不改。前文和当前这一段里的名字都跟着换 */
export function rename(s: DemoState, draft: string): DemoState {
  const name = clampName(s.story, draft).trim();
  if (!name || name === s.name) return s;
  // 正在逐字写的这一段，已经写出来的字数不变；写完了的显示新名字的全文
  const shown = s.phase === "idle" ? fullText(s.story, s.node, name).length : s.shown;
  return { ...s, name, shown };
}

/** “自己写”发出去：空的不发 */
export function send(s: DemoState, draft: string): DemoState {
  const typed = draft.trim();
  return typed ? { ...s, typed } : s;
}

/** 打开世界面板不改状态；收起时新条目都算看过了 */
export function seenWorld(s: DemoState): DemoState {
  return { ...s, fresh: [], upd: [] };
}

export type Segment = { text: string; act: string | null; caret: boolean };

/** 正文：读完的段落带当时选的行动，最后是正在写（或刚写完）的一段 */
export function segments(s: DemoState): Segment[] {
  const past = s.steps.map((x) => ({
    text: fullText(s.story, x.node, s.name),
    act: optionsOf(s.story, x.node)?.[x.pick]?.label ?? null,
    caret: false,
  }));
  const cur = s.phase === "thinking" ? "" : fullText(s.story, s.node, s.name).slice(0, s.shown);
  return [...past, { text: cur, act: null, caret: s.phase !== "idle" }];
}

export type WorldEntry = {
  id: EntityId;
  name: string;
  note: string;
  kind: EntityKind;
  kindLabel: string;
  me: boolean;
  /** 还没在世界面板里看过（出现时有一个淡入） */
  fresh: boolean;
  isNew: boolean;
  isUpd: boolean;
};

/** 世界面板：最新出现的在最上面；没看过的标“新”，改过的标“更新” */
export function worldEntries(s: DemoState): WorldEntry[] {
  return [...s.found].reverse().map((id) => {
    const e = s.story.entities[id];
    const kind = ENTITY_KINDS[id];
    const me = id === "me";
    const isUpd = s.upd.includes(id);
    const fresh = s.fresh.includes(id);
    return {
      id,
      name: fillName(e.name, s.name),
      note: e.note,
      kind,
      kindLabel: me ? s.story.me : s.story.kinds[kind],
      me,
      fresh,
      isNew: fresh && !isUpd,
      isUpd,
    };
  });
}

/** 底部状态栏的字 */
export function statusText(s: DemoState): string {
  if (s.phase === "thinking") return s.story.thinking;
  return s.node === "root" ? s.story.writingOpening : s.story.writingNext;
}
