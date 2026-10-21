/**
 * 首屏演示：预先写好的一棵小故事树（两轮选项后结束）和它的推进规则，照设计稿 LandingDemo.dc.html 搬。
 * 这里只有数据和纯函数，计时器在 Demo.tsx 里。测试见 story.test.ts。
 *
 * 推进：begin 进入一段（先“构思”，再逐字写出）→ tick 每次多显示两个字 → 写完（finish）出现选项，
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

export type StoryNode = {
  /** 正文；{n} 换成主角的名字 */
  text: string;
  options?: readonly { label: string; next: NodeId }[];
  /** 写完这一段，世界里新出现的条目 */
  adds?: readonly EntityId[];
  /** 不再单独列出的条目（“舱门后的人”原来是阿潮） */
  drops?: readonly EntityId[];
  /** 标成“更新”的条目 */
  upd?: readonly EntityId[];
};

export const STORY: Record<NodeId, StoryNode> = {
  root: {
    text: "雾是从海面漫上来的。我走到码头尽头的时候，它已经没过了栏杆。灯塔就在前面，灯却是灭的。\n\n老周在信里说过：雾港的灯一旦灭了，就得有人去点上——可写这封信的人，三天前就不见了。\n\n身后响起一声钟，低沉，潮湿，像是从水底浮上来的。",
    options: [
      { label: "先爬上灯塔，把灯点亮", next: "a" },
      { label: "回头去找那口钟", next: "b" },
    ],
    adds: ["me", "pier", "tower", "keeper", "bell"],
  },
  a: {
    text: "塔里的楼梯又窄又陡。爬到一半，我听见上面有翻纸的声音。\n\n灯室的门半掩着。一个穿灰外套的女人坐在熄灭的灯旁，膝上摊着一本航海日志。她抬起头，像是早就在等我。\n\n“{n}？”她说，“老周说你会来的。”",
    options: [
      { label: "问她老周去了哪里", next: "aa" },
      { label: "先看那本航海日志", next: "ab" },
    ],
    adds: ["grey", "log"],
  },
  b: {
    text: "钟声是从雾里一条旧船上传来的。船身没有名字，缆绳还在往下滴水。\n\n我刚踏上跳板，钟又响了一下，这一次就在耳边。舱门后面有人压低了声音：\n\n“别点灯，{n}。灯一亮，它们就知道你来了。”",
    options: [
      { label: "推开舱门", next: "ba" },
      { label: "退回码头，去点灯", next: "bb" },
    ],
    adds: ["ship", "voice"],
  },
  aa: {
    text: "“他去追一条船了。”女人合上日志，“一条三十年前就沉了的船。”\n\n她把火柴推到我面前：“灯得由你来点。点亮以后，你会看见他看见的东西。”\n\n我划着火柴的时候，窗外的雾里亮起了第二盏灯。可雾港只有这一座灯塔。",
    adds: ["f_light"],
  },
  ab: {
    text: "日志的最后一页是老周的字，墨迹还没干：\n\n“今晚它们会回来。灯亮着，船就靠不了岸。”\n\n下面一行写得很急：“要是我没回来，告诉{n}——别信那口钟。”我抬起头，灰外套的女人已经不在了，椅子还是温的。",
    adds: ["f_bell"],
  },
  ba: {
    text: "舱里只有一个孩子，抱着一盏没点的提灯，冻得发抖。\n\n他说他叫阿潮，是老周的孙子。“爷爷说，钟响三声，就有人要回来。”\n\n他盯着我身后的雾，小声说：“已经响了两声了。”",
    adds: ["chao"],
    drops: ["voice"],
    upd: ["chao"],
  },
  bb: {
    text: "我退回码头，雾已经漫过了脚踝。跑到灯塔下面时，钟响了第三声。\n\n塔门开着。楼梯上有一串湿脚印，一直往上——有人比我先到了。",
    adds: ["f_steps"],
  },
};

export type EntityKind = "person" | "place" | "item" | "fact";

export const ENTITIES: Record<EntityId, { kind: EntityKind; name: string; note: string; me?: true }> = {
  me: { kind: "person", name: "{n}", note: "新来的守夜人", me: true },
  pier: { kind: "place", name: "雾港码头", note: "雾已经没过了栏杆" },
  tower: { kind: "place", name: "灯塔", note: "灯是灭的" },
  keeper: { kind: "person", name: "老周", note: "守塔人，三天前不见了" },
  bell: { kind: "item", name: "旧船钟", note: "声音像从水底浮上来" },
  grey: { kind: "person", name: "灰外套的女人", note: "像是早就在等我" },
  log: { kind: "item", name: "航海日志", note: "老周的字" },
  ship: { kind: "place", name: "无名旧船", note: "缆绳还在滴水" },
  voice: { kind: "person", name: "舱门后的人", note: "不让我点灯" },
  chao: { kind: "person", name: "阿潮", note: "老周的孙子，刚才是他在舱门后说话" },
  f_light: { kind: "fact", name: "雾里亮起了第二盏灯", note: "可雾港只有一座灯塔" },
  f_bell: { kind: "fact", name: "日志里写着：别信那口钟", note: "老周留下的话" },
  f_steps: { kind: "fact", name: "楼梯上有一串湿脚印", note: "有人先到了" },
};

export const DEFAULT_NAME = "林深";
/** 名字最多几个字 */
export const NAME_MAX = 8;
/** “自己写”最多几个字 */
export const DRAFT_MAX = 200;
/** 每一拍多显示几个字 */
export const TICK_CHARS = 2;
/** 逐字出现的间隔、开始写之前“构思”多久、点了选项以后多久进入下一段（毫秒） */
export const TIMING = { tick: 42, thinkFirst: 900, think: 650, afterPick: 260 } as const;

export type Phase = "thinking" | "writing" | "idle";

export type DemoState = {
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
export function fill(text: string, name: string): string {
  return text.replace(/\{n\}/g, name);
}

export function fullText(node: NodeId, name: string): string {
  return fill(STORY[node].text, name);
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
  return {
    ...s,
    phase: "idle",
    shown: fullText(s.node, s.name).length,
    live: fullText(s.node, s.name),
    found,
    fresh,
    upd: [...s.upd, ...(st.upd ?? [])],
  };
}

const EMPTY: DemoState = {
  name: DEFAULT_NAME,
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

/** 预渲染和 hydrate 时的样子：第一段已经写完，两个选项在下面 */
export function initialState(name: string = DEFAULT_NAME): DemoState {
  // 页面刚打开时不让读屏把第一段再念一遍：它就在页面上
  return { ...finish({ ...EMPTY, name }), live: "" };
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

/** 多显示几个字；到头就算写完 */
export function tick(s: DemoState, chars: number = TICK_CHARS): DemoState {
  if (s.phase !== "writing") return s;
  const shown = s.shown + chars;
  return shown >= fullText(s.node, s.name).length ? finish(s) : { ...s, shown };
}

/** “全部显示”：跳过逐字 */
export function skip(s: DemoState): DemoState {
  return s.phase === "idle" ? s : finish(s);
}

/** 点一个选项。还在写、已经点过、或者没有这个选项时不变 */
export function choose(s: DemoState, i: number): DemoState {
  if (s.phase !== "idle" || s.chosen !== null) return s;
  if (!STORY[s.node].options?.[i]) return s;
  return { ...s, chosen: i };
}

/** 点过选项以后：这一段记进前文，进入下一段；“自己写”的那一句清掉 */
export function advance(s: DemoState, reduce: boolean): DemoState {
  if (s.chosen === null) return s;
  const opt = STORY[s.node].options?.[s.chosen];
  if (!opt) return s;
  return begin({ ...s, steps: [...s.steps, { node: s.node, pick: s.chosen }], typed: "" }, opt.next, reduce);
}

/** 从头再读：保留名字，其余回到开头，第一段重新逐字写 */
export function restart(s: DemoState, reduce: boolean): DemoState {
  return begin({ ...EMPTY, name: s.name }, "root", reduce);
}

export function isEnded(s: DemoState): boolean {
  return s.phase === "idle" && !STORY[s.node].options;
}

/** 输入框里的名字：最多 NAME_MAX 个字 */
export function clampName(input: string): string {
  return input.slice(0, NAME_MAX);
}

/** 改名字：去掉首尾空白；空的不改。前文和当前这一段里的名字都跟着换 */
export function rename(s: DemoState, draft: string): DemoState {
  const name = clampName(draft).trim();
  if (!name || name === s.name) return s;
  // 正在逐字写的这一段，已经写出来的字数不变；写完了的显示新名字的全文
  const shown = s.phase === "idle" ? fullText(s.node, name).length : s.shown;
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
    text: fullText(x.node, s.name),
    act: STORY[x.node].options?.[x.pick]?.label ?? null,
    caret: false,
  }));
  const cur = s.phase === "thinking" ? "" : fullText(s.node, s.name).slice(0, s.shown);
  return [...past, { text: cur, act: null, caret: s.phase !== "idle" }];
}

const KIND_LABEL: Record<EntityKind, string> = { person: "人物", place: "地点", item: "物品", fact: "事实" };

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
    const e = ENTITIES[id];
    const isUpd = s.upd.includes(id);
    const fresh = s.fresh.includes(id);
    return {
      id,
      name: fill(e.name, s.name),
      note: e.note,
      kind: e.kind,
      kindLabel: e.me ? "我" : KIND_LABEL[e.kind],
      me: !!e.me,
      fresh,
      isNew: fresh && !isUpd,
      isUpd,
    };
  });
}

/** 底部状态栏的字 */
export function statusText(s: DemoState): string {
  if (s.phase === "thinking") return "正在构思…";
  return s.node === "root" ? "正在写开场" : "正在写下一段";
}
