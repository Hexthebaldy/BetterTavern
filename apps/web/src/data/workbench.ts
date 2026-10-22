/** 工作台和角色卡仓库的地址 */

export function draftPath(id: string): string {
  return `/workbench/d/${encodeURIComponent(id)}`;
}

export function cardPath(id: string): string {
  return `/card/${encodeURIComponent(id)}`;
}
