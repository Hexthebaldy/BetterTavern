/**
 * 网页怎么出声（docs/speech.md）：设备自带的声音用浏览器的朗读（speechSynthesis），
 * 语音服务的声音取回来放进一个 <audio>。规则和播放顺序在 @bettertavern/core/play/speechPlayer。
 *
 * 浏览器规定页面要被点过才能出声；Safari 更严，<audio> 要在点击的那一下里放过一次（unlock）。
 * 浏览器朗读的“取消”是异步的：取消了马上读下一小段，有的浏览器会把下一小段一起取消，
 * 所以要等上一小段回话说停了（最多等 STOP_SETTLE_MS）再开始。
 */

import type { Api } from "@bettertavern/core/api/endpoints";
import { LANGUAGE_TAGS } from "@bettertavern/core/i18n/index";
import { speechCacheKey, type SpeechLine } from "@bettertavern/core/play/speech";
import { AudioLoader, SpeechFailure, type SpeechEngine } from "@bettertavern/core/play/speechPlayer";

/** 一段没有声音的 wav：点击的那一下放它，解开 Safari 的限制 */
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** 取消浏览器朗读以后，最多等它这么久回话 */
const STOP_SETTLE_MS = 300;

export type WebSpeechEngine = SpeechEngine & {
  /** 在点击的那一下调用 */
  unlock(): void;
  dispose(): void;
};

export class BrowserVoice implements WebSpeechEngine {
  /** 留着引用：Chrome 里没人引用的朗读对象可能被回收，事件就不来了 */
  private current: SpeechSynthesisUtterance | null = null;
  private finish: (() => void) | null = null;
  /** 上一次取消已经落定 */
  private settled: Promise<void> = Promise.resolve();
  private stopped: (() => void) | null = null;

  unlock(): void {}
  prepare(): void {}
  setRate(): void {} // 浏览器的朗读开始以后改不了语速：下一小段生效

  speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void> {
    const synth = window.speechSynthesis as SpeechSynthesis | undefined;
    if (!synth) return Promise.reject(new SpeechFailure("device"));
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = LANGUAGE_TAGS[line.language];
      utterance.rate = rate;
      const voice = line.voice ? synth.getVoices().find((v) => v.voiceURI === line.voice) : undefined;
      if (voice) utterance.voice = voice;
      utterance.onstart = onStart;
      utterance.onend = () => {
        if (this.current === utterance) this.current = null;
        resolve();
      };
      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") {
          this.stopped?.();
          this.stopped = null;
          resolve();
        } else reject(new SpeechFailure(event.error === "not-allowed" ? "autoplay" : "device"));
      };
      this.current = utterance;
      this.finish = resolve;
      void this.settled.then(() => {
        if (this.current === utterance) synth.speak(utterance);
      });
    });
  }

  pause(): void {
    window.speechSynthesis?.pause();
  }

  resume(): void {
    window.speechSynthesis?.resume();
  }

  stop(): void {
    if (this.current) {
      this.settled = new Promise<void>((resolve) => {
        this.stopped = resolve;
        setTimeout(resolve, STOP_SETTLE_MS);
      });
    }
    window.speechSynthesis?.cancel();
    // 暂停着取消的话，Chrome 还记着“暂停”，下一段就不出声了
    window.speechSynthesis?.resume();
    this.finish?.();
    this.finish = null;
    this.current = null;
  }

  dispose(): void {
    this.stop();
  }
}

export class ServiceVoice implements WebSpeechEngine {
  private readonly audio = new Audio();
  private readonly loader: AudioLoader<string>;
  private readonly routeId: string;
  private finish: (() => void) | null = null;
  private speaking = 0;

  constructor(api: Api, routeId: string) {
    this.routeId = routeId;
    this.loader = new AudioLoader<string>(
      async (_key, line) => {
        const { data, mime } = await api.speech.synthesize({
          text: line.text,
          route_id: routeId,
          ...(line.voice ? { voice: line.voice } : {}),
        });
        return URL.createObjectURL(new Blob([data], { type: mime || "audio/mpeg" }));
      },
      (url) => URL.revokeObjectURL(url),
    );
  }

  unlock(): void {
    if (!this.audio.paused) return;
    this.audio.src = SILENT;
    void this.audio.play().catch(() => undefined);
  }

  prepare(line: SpeechLine): void {
    void this.loader.get(speechCacheKey(this.routeId, line), line).catch(() => undefined);
  }

  async speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void> {
    this.speaking += 1;
    const speaking = this.speaking;
    const url = await this.loader.get(speechCacheKey(this.routeId, line), line);
    if (speaking !== this.speaking) return; // 等声音的时候被停了
    const { audio } = this;
    await new Promise<void>((resolve, reject) => {
      this.finish = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new SpeechFailure("bad_response"));
      audio.src = url;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      audio.play().then(onStart, (error: unknown) => {
        const name = error instanceof Error ? error.name : "";
        if (name === "AbortError") resolve();
        else reject(new SpeechFailure(name === "NotAllowedError" ? "autoplay" : "bad_response"));
      });
    });
  }

  setRate(rate: number): void {
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    void this.audio.play().catch(() => undefined);
  }

  stop(): void {
    this.speaking += 1;
    this.audio.pause();
    this.audio.onerror = null;
    this.audio.removeAttribute("src");
    this.finish?.();
    this.finish = null;
  }

  dispose(): void {
    this.stop();
    this.loader.clear();
  }
}
