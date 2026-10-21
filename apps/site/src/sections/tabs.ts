/** 标签栏的键盘操作（WAI-ARIA 的 tabs 模式）：左右键换到前一个、后一个（两头循环），Home、End 到第一个、最后一个。测试见 tabs.test.ts */

/** 按了 key 以后选第几个标签；别的键返回 null（不处理） */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
