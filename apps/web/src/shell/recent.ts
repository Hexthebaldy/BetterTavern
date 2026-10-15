/**
 * 侧栏“最近的故事”：按更新时间从新到旧，分成“今天 / 本周 / 更早”三组（本周从周一算起，按本地时间）。
 * 空的组不出现。导航条只放最近四个。
 */

export type RecentGroup<T> = { label: "今天" | "本周" | "更早"; items: T[] };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfWeek(date: Date): number {
  const day = date.getDay(); // 0 是周日
  const back = day === 0 ? 6 : day - 1;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime();
}

export function byRecent<T extends { updated_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function recentGroups<T extends { updated_at: string }>(
  items: readonly T[],
  now: Date = new Date(),
): RecentGroup<T>[] {
  const today = startOfDay(now);
  const week = startOfWeek(now);
  const groups: RecentGroup<T>[] = [
    { label: "今天", items: [] },
    { label: "本周", items: [] },
    { label: "更早", items: [] },
  ];
  for (const item of byRecent(items)) {
    const at = Date.parse(item.updated_at);
    const group = at >= today ? groups[0] : at >= week ? groups[1] : groups[2];
    group?.items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}
