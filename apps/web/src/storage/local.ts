/**
 * 浏览器存储（localStorage）的薄封装。隐私模式、存满、被禁用时读不到也写不进：一律当作没存过，不抛错，
 * 写不进只影响下次打开。内容是 JSON；解析不了的当作没有。
 */

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export class SafeStore {
  private readonly backing: () => KeyValueStore | null;

  constructor(backing: () => KeyValueStore | null) {
    this.backing = backing;
  }

  read(key: string): unknown {
    try {
      const raw = this.backing()?.getItem(key);
      return raw == null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  write(key: string, value: unknown): void {
    try {
      this.backing()?.setItem(key, JSON.stringify(value));
    } catch {
      // 存不进去：下次打开时用默认值
    }
  }

  remove(key: string): void {
    try {
      this.backing()?.removeItem(key);
    } catch {
      // 同上
    }
  }
}

/** 页面里用的那一个：访问 window.localStorage 本身也可能抛错（禁用了站点数据） */
export const localStore = new SafeStore(() => (typeof localStorage === "undefined" ? null : localStorage));
