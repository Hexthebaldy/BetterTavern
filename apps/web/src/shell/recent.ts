/** 存档按更新时间从新到旧（存档页用） */

export function byRecent<T extends { updated_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
