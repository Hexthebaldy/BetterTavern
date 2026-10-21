/** 导航跟着滚动变化：往下滚以后多一道蓝线；当前所在的节在导航里高亮。测试见 scroll.test.ts */

/** 按页面上的顺序；“客户端”不在导航条里，滚到那里时导航不高亮任何一项 */
export const SECTION_IDS = ["how", "world", "more", "models", "clients", "deploy", "faq"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** 节的顶边滚到离窗口顶部这么近时，算进入了这一节（导航 72px 高，再留一点） */
export const SECTION_LINE = 140;

/** 往下滚了一点以后，导航的粗黑线下面多一道蓝 */
export function isScrolled(scrollY: number): boolean {
  return scrollY > 8;
}

/**
 * 当前所在的节：顶边已经到了 line 以上的节里，最后一个。还没滚到第一节时是 null。
 * tops 是各节顶边离窗口顶部的距离（getBoundingClientRect().top），按页面上的顺序。
 */
export function currentSection<T extends string>(
  tops: readonly { id: T; top: number }[],
  line: number = SECTION_LINE,
): T | null {
  let cur: T | null = null;
  for (const s of tops) if (s.top <= line) cur = s.id;
  return cur;
}
