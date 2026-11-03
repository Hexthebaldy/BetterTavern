/**
 * 朗读的播放（docs/speech.md）：按顺序读一回合的一小段一小段，可以暂停、跳到下一段、停止；
 * 回合还在写时读完已经写好的就等着，写出新的一段接着读。
 *
 * 怎么出声由 SpeechEngine 负责（网页：浏览器的朗读、<audio>；App：系统的朗读、expo-audio）。
 * TurnReader 把阅读页的状态接进来：点“朗读”读一回合、正在读的回合写出了新的段落、自动朗读新回合、回合被回退了就停。
 */

import { ApiError } from "../api/client.ts";
import { headTurn, type PlayState } from "./turnMachine.ts";
import { speechLines, type SpeechContext, type SpeechLine, type SpeechTurn } from "./speech.ts";

/** 没读出来的原因：SPEECH_FAILED 的 reason，或者下面这几个 */
export type SpeechReason =
  | "auth"
  | "quota"
  | "blocked"
  | "timeout"
  | "http"
  | "network"
  | "bad_response"
  | "unsupported"
  | "not_configured"
  | "credential"
  | "rate_limited"
  | "offline"
  | "device"
  /** 浏览器不让页面自己出声（还没点过页面） */
  | "autoplay";

const SERVICE_REASONS = new Set(["auth", "quota", "blocked", "timeout", "http", "network", "bad_response", "unsupported"]);

export class SpeechFailure extends Error {
  readonly reason: SpeechReason;

  constructor(reason: SpeechReason) {
    super(reason);
    this.name = "SpeechFailure";
    this.reason = reason;
  }
}

export function speechReason(error: unknown): SpeechReason {
  if (error instanceof SpeechFailure) return error.reason;
  if (!(error instanceof ApiError)) return "device";
  if (error.isNetwork) return "offline";
  if (error.code === "SPEECH_FAILED") {
    const reason = error.field("reason");
    return typeof reason === "string" && SERVICE_REASONS.has(reason) ? (reason as SpeechReason) : "http";
  }
  if (error.code === "SPEECH_NOT_CONFIGURED" || error.code === "NOT_FOUND") return "not_configured";
  if (error.code === "CREDENTIAL_UNREADABLE") return "credential";
  if (error.code === "RATE_LIMITED") return "rate_limited";
  return "http";
}

/** 界面文字的键（play.speech.errors.*） */
export function speechErrorKey(reason: SpeechReason): `play.speech.errors.${SpeechReason}` {
  return `play.speech.errors.${reason}`;
}

export interface SpeechEngine {
  /** 提前把下一小段准备好，读到时不用等（设备自带的声音不用准备） */
  prepare(line: SpeechLine): void;
  /**
   * 读一小段：读完（或者被 stop）时结束，读不出来时抛出错误。真的开始出声时调用 onStart。
   * 调用 speak 时不能有上一段还在读。
   */
  speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void>;
  /** 正在读时改语速 */
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export type SpeechStatus =
  | "idle"
  /** 在等这一小段的声音 */
  | "loading"
  | "playing"
  | "paused"
  /** 写好的都读完了，等回合写出新的一段 */
  | "waiting"
  | "failed";

export type SpeechState = {
  status: SpeechStatus;
  /** 正在读哪一回合；没在读是 null */
  turnId: string | null;
  /** 读到哪一段（readingSpot）：界面标墨线用 */
  spot: string | null;
  /** 第几段（从 1 起）、一共几段：一段可能切成几小段，这里数的是段 */
  paragraph: number;
  paragraphs: number;
  reason: SpeechReason | null;
};

export const IDLE_SPEECH: SpeechState = {
  status: "idle",
  turnId: null,
  spot: null,
  paragraph: 0,
  paragraphs: 0,
  reason: null,
};

export class SpeechPlayer {
  private engine: SpeechEngine;
  private rate = 1;
  private lines: SpeechLine[] = [];
  private index = 0;
  /** 回合还在写，读完了不算结束 */
  private open = false;
  /** 每开始一轮新的播放就加一：旧的那一轮回来时发现对不上就不再往下走 */
  private run = 0;
  private state: SpeechState = IDLE_SPEECH;
  private readonly listeners = new Set<() => void>();

  constructor(engine: SpeechEngine) {
    this.engine = engine;
  }

  getState = (): SpeechState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 换声音来源：正在读的停下 */
  setEngine(engine: SpeechEngine): void {
    if (engine === this.engine) return;
    this.stop();
    this.engine = engine;
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.engine.setRate(rate);
  }

  /** 从头读一回合（正在读别的就换过来） */
  read(turnId: string, lines: SpeechLine[], open = false): void {
    this.halt();
    this.lines = lines;
    this.index = 0;
    this.open = open;
    this.set({ status: "loading", turnId, reason: null });
    void this.play();
  }

  /** 正在读的回合写出了新的段落，或者写完了 */
  update(turnId: string, lines: SpeechLine[], open: boolean): void {
    if (this.state.turnId !== turnId) return;
    this.lines = lines;
    this.open = open;
    if (this.state.status === "waiting") {
      if (this.index < lines.length) {
        this.set({ status: "loading" });
        void this.play();
      } else if (!open) {
        this.finish();
      } else {
        this.publishPosition();
      }
      return;
    }
    if (this.state.status === "failed") return;
    this.publishPosition();
    const next = lines[this.index + 1];
    if (next) this.engine.prepare(next);
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.engine.pause();
    this.set({ status: "paused" });
  }

  resume(): void {
    if (this.state.status !== "paused") return;
    this.engine.resume();
    this.set({ status: "playing" });
  }

  /** 读不出来以后再试一次：接着没读出来的那一小段 */
  retry(): void {
    if (this.state.status !== "failed") return;
    this.set({ status: "loading", reason: null });
    void this.play();
  }

  /** 跳到下一段（不是下一小段）；已经是最后一段时等于读完了 */
  next(): void {
    if (this.state.turnId === null) return;
    const spot = this.lines[this.index]?.spot;
    this.halt();
    let index = this.index;
    while (index < this.lines.length && this.lines[index]?.spot === spot) index += 1;
    this.index = index;
    this.set({ status: "loading", reason: null });
    void this.play();
  }

  stop(): void {
    if (this.state.turnId === null) return;
    this.halt();
    this.finish();
  }

  /** 停掉正在出声的一小段，让还在跑的那一轮不再往下走 */
  private halt(): void {
    this.run += 1;
    this.engine.stop();
  }

  private finish(): void {
    this.lines = [];
    this.index = 0;
    this.open = false;
    this.state = IDLE_SPEECH;
    this.emit();
  }

  private async play(): Promise<void> {
    this.run += 1;
    const run = this.run;
    const engine = this.engine;
    while (run === this.run) {
      const line = this.lines[this.index];
      if (!line) {
        if (this.open) this.set({ status: "waiting", spot: null });
        else this.finish();
        return;
      }
      this.publishPosition();
      const next = this.lines[this.index + 1];
      if (next) engine.prepare(next);
      if (this.state.status !== "paused") this.set({ status: "loading" });
      try {
        await engine.speak(line, this.rate, () => {
          if (run === this.run && this.state.status === "loading") this.set({ status: "playing" });
        });
      } catch (error) {
        if (run === this.run) this.set({ status: "failed", reason: speechReason(error) });
        return;
      }
      if (run === this.run) this.index += 1;
    }
  }

  private publishPosition(): void {
    const spots: string[] = [];
    for (const line of this.lines) if (spots[spots.length - 1] !== line.spot) spots.push(line.spot);
    const spot = this.lines[this.index]?.spot ?? null;
    this.set({ spot, paragraph: spot === null ? spots.length : spots.indexOf(spot) + 1, paragraphs: spots.length });
  }

  private set(change: Partial<SpeechState>): void {
    const next = { ...this.state, ...change };
    if ((Object.keys(next) as (keyof SpeechState)[]).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const WRITING: readonly PlayState["phase"][] = ["submitting", "streaming", "reconnecting", "polling"];

/** 把阅读页的状态接到播放上。context 每次用时才取，换了声音下次读就是新的 */
export class TurnReader {
  private readonly player: SpeechPlayer;
  private readonly context: () => SpeechContext;
  /** 已经见过的最新回合：打开故事时就写好的回合不自动读，回退以后也不读 */
  private seenSeq: number | null = null;
  /** 自动朗读已经接手过的回合：读完、被停掉以后不再读一遍 */
  private autoTurn: string | null = null;
  /** 正在读的回合上次切出来的文字：没变就不用重新切 */
  private lastText = "";
  private lastOpen = false;

  constructor(player: SpeechPlayer, context: () => SpeechContext) {
    this.player = player;
    this.context = context;
  }

  /** 点“朗读”：读这一回合。正在写的回合只读写完的段落，写出新的接着读 */
  read(turnId: string, turn: SpeechTurn, writing = false): void {
    this.autoTurn = turnId;
    this.remember(turn, writing);
    this.player.read(turnId, speechLines(turn, this.context(), !writing), writing);
  }

  /** 阅读页的状态变了就调用。auto：自动朗读新回合 */
  sync(state: PlayState, auto: boolean): void {
    if (state.phase === "loading" || state.phase === "load_failed") return;
    const head = headTurn(state);
    const headSeq = head?.seq ?? -1;
    if (this.seenSeq === null || headSeq < this.seenSeq) this.seenSeq = headSeq;
    const { pending } = state;
    const writing = WRITING.includes(state.phase);
    const current = this.player.getState().turnId;
    if (current !== null) {
      const settled = state.turns.find((t) => t.id === current);
      if (pending?.turnId === current) this.follow(current, pending, writing);
      else if (settled) this.follow(current, settled, false);
      else this.player.stop(); // 回合被回退掉了，或者失败的回合被关掉了
    }
    if (auto) this.autoRead(state, head, writing);
    this.seenSeq = Math.max(this.seenSeq, headSeq);
  }

  private autoRead(state: PlayState, head: PlayState["turns"][number] | null, writing: boolean): void {
    const { status, turnId } = this.player.getState();
    if (status === "paused") return; // 玩家按了暂停：不替他接着读
    const { pending } = state;
    if (pending?.turnId && pending.turnId !== turnId && pending.turnId !== this.autoTurn) {
      const lines = speechLines(pending, this.context(), !writing);
      if (lines.length === 0) return; // 第一段还没写完
      this.autoTurn = pending.turnId;
      this.remember(pending, writing);
      this.player.read(pending.turnId, lines, writing);
      return;
    }
    if (head && head.seq > (this.seenSeq ?? -1) && head.id !== turnId && head.id !== this.autoTurn) {
      // 没赶上写的过程（比如断线以后轮询到的）：回合已经写完了
      this.read(head.id, head);
    }
  }

  private follow(turnId: string, turn: SpeechTurn, writing: boolean): void {
    const text = this.fingerprint(turn);
    if (text === this.lastText && writing === this.lastOpen) return;
    this.lastText = text;
    this.lastOpen = writing;
    this.player.update(turnId, speechLines(turn, this.context(), !writing), writing);
  }

  private remember(turn: SpeechTurn, writing: boolean): void {
    this.lastText = this.fingerprint(turn);
    this.lastOpen = writing;
  }

  private fingerprint(turn: SpeechTurn): string {
    return turn.segments.length > 0 ? turn.segments.map((s) => s.text).join("\n\u0000") : turn.narrative;
  }
}

/** 取声音（下载、缓存）的公共部分：同一段只取一次，最多留 limit 段，取失败的不留 */
export class AudioLoader<T> {
  private readonly loads = new Map<string, Promise<T>>();
  private readonly load: (key: string, line: SpeechLine) => Promise<T>;
  private readonly release: (value: T) => void;
  private readonly limit: number;

  constructor(load: (key: string, line: SpeechLine) => Promise<T>, release: (value: T) => void, limit = 60) {
    this.load = load;
    this.release = release;
    this.limit = limit;
  }

  get(key: string, line: SpeechLine): Promise<T> {
    const known = this.loads.get(key);
    if (known) {
      this.loads.delete(key); // 放回最后：最近用过的留得久
      this.loads.set(key, known);
      return known;
    }
    const loading = this.load(key, line);
    this.loads.set(key, loading);
    loading.catch(() => {
      if (this.loads.get(key) === loading) this.loads.delete(key);
    });
    while (this.loads.size > this.limit) {
      const oldest = this.loads.keys().next().value;
      if (oldest === undefined) break;
      const value = this.loads.get(oldest);
      this.loads.delete(oldest);
      void value?.then(this.release, () => undefined);
    }
    return loading;
  }

  clear(): void {
    for (const value of this.loads.values()) void value.then(this.release, () => undefined);
    this.loads.clear();
  }
}
