/**
 * iOS 上“正在收回的 <Modal>”的登记（纯逻辑，用 node --test 测；React 那一层在 gatedModal.ts）。
 *
 * iOS 的一个视图控制器同一时间只能 present 一个视图控制器。我们自己带 <Modal> 的组件（Sheet、非 inline 的 Dialog、
 * 平板的 CardMenu）都写在页面层级，都由根视图控制器 present：上一个还没被 iOS 收回（dismiss 完成）就 present 下一个，
 * iOS 会拒绝，界面停在点不动的状态。
 *
 * 做法：组件开始关闭时 beginDismiss，收到 <Modal> 的 onDismiss（iOS 确认已经收回）时 endDismiss；
 * 要 present 新 <Modal> 的组件用 whenNoneDismissing 等登记清空再 present。
 * <Modal> 还没被 present 就关掉时 iOS 不会收回它，也就不会有 onDismiss：每个登记带一个保底超时，
 * 到点当作已经收回，调用登记时给的 onForced，并经 onTimeout 记一条诊断日志。正常流程不依赖这个超时。
 */

/** 保底超时：正常的收回远远用不了这么久 */
export const DISMISS_TIMEOUT_MS = 1000;

export type ModalGateOptions = {
  timeoutMs?: number;
  /** 保底超时触发时调用（记诊断日志用） */
  onTimeout?: (id: string, waitedMs: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
};

type Entry = { timer: unknown; startedAt: number; onForced?: () => void };

export class ModalGate {
  private readonly entries = new Map<string, Entry>();
  private waiters: (() => void)[] = [];
  private readonly timeoutMs: number;
  private readonly onTimeout?: (id: string, waitedMs: number) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;

  constructor(options: ModalGateOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DISMISS_TIMEOUT_MS;
    this.onTimeout = options.onTimeout;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.now = options.now ?? Date.now;
  }

  /** 正在收回的 <Modal> 有几个 */
  get pending(): number {
    return this.entries.size;
  }

  /** 某个 <Modal> 开始关闭；同一个 id 重复登记不算两次 */
  beginDismiss(id: string, onForced?: () => void): void {
    if (this.entries.has(id)) return;
    const startedAt = this.now();
    const timer = this.setTimer(() => {
      const entry = this.entries.get(id);
      if (!entry) return;
      this.onTimeout?.(id, this.now() - entry.startedAt);
      this.entries.delete(id);
      entry.onForced?.();
      this.release();
    }, this.timeoutMs);
    this.entries.set(id, { timer, startedAt, onForced });
  }

  /** iOS 确认这个 <Modal> 已经收回；没登记过（或已经超时）就什么都不做 */
  endDismiss(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.clearTimer(entry.timer);
    this.entries.delete(id);
    this.release();
  }

  /** 没有正在收回的 <Modal> 就马上执行，否则等全部收回再执行。返回取消函数 */
  whenNoneDismissing(fn: () => void): () => void {
    if (this.entries.size === 0) {
      fn();
      return () => undefined;
    }
    this.waiters.push(fn);
    return () => {
      this.waiters = this.waiters.filter((w) => w !== fn);
    };
  }

  private release(): void {
    if (this.entries.size > 0) return;
    const ready = this.waiters;
    this.waiters = [];
    for (const fn of ready) fn();
  }
}
