/**
 * App 怎么出声（docs/speech.md）：设备自带的声音用系统的朗读（expo-speech），
 * 语音服务的声音下载到缓存目录再放（expo-audio）。规则和播放顺序在 @bettertavern/core/play/speechPlayer。
 *
 * 安卓的系统朗读不能暂停：暂停时停掉这一小段，继续时从这一小段的开头重新读。
 */

import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import * as Speech from "expo-speech";
import { Platform } from "react-native";

import type { Api } from "@bettertavern/core/api/endpoints";
import { LANGUAGE_TAGS } from "@bettertavern/core/i18n/index";
import { speechCacheKey, type SpeechLine } from "@bettertavern/core/play/speech";
import { AudioLoader, SpeechFailure, type SpeechEngine } from "@bettertavern/core/play/speechPlayer";

export type AppSpeechEngine = SpeechEngine & { dispose(): void };

/** 开始以后这么久还没出声，算读不出来（有的系统没有这种语言的声音时什么也不回） */
const START_TIMEOUT_MS = 15_000;

type Speaking = {
  line: SpeechLine;
  rate: number;
  onStart: () => void;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

export class DeviceVoice implements AppSpeechEngine {
  private current: Speaking | null = null;
  /** 安卓暂停时的 stop：不算读完 */
  private holding = false;

  prepare(): void {}
  setRate(): void {} // 系统的朗读开始以后改不了语速：下一小段生效

  speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.current = { line, rate, onStart, resolve, reject, timer: null };
      this.start();
    });
  }

  private start(): void {
    const speaking = this.current;
    if (!speaking) return;
    const { line, rate } = speaking;
    const clear = (): void => {
      if (speaking.timer) clearTimeout(speaking.timer);
      speaking.timer = null;
    };
    const done = (): void => {
      clear();
      if (this.current === speaking) this.current = null;
      speaking.resolve();
    };
    const failed = (): void => {
      clear();
      void Speech.stop();
      if (this.current === speaking) this.current = null;
      speaking.reject(new SpeechFailure("device"));
    };
    clear();
    speaking.timer = setTimeout(failed, START_TIMEOUT_MS);
    Speech.speak(line.text, {
      language: LANGUAGE_TAGS[line.language],
      rate,
      ...(line.voice ? { voice: line.voice } : {}),
      onStart: () => {
        clear();
        speaking.onStart();
      },
      onDone: done,
      onStopped: () => {
        if (!this.holding) done();
      },
      onError: failed,
    });
  }

  pause(): void {
    if (Platform.OS === "ios") {
      void Speech.pause();
      return;
    }
    this.holding = true;
    if (this.current?.timer) clearTimeout(this.current.timer);
    void Speech.stop();
  }

  resume(): void {
    if (Platform.OS === "ios") {
      void Speech.resume();
      return;
    }
    this.holding = false;
    this.start();
  }

  stop(): void {
    this.holding = false;
    void Speech.stop();
    const speaking = this.current;
    this.current = null;
    if (speaking?.timer) clearTimeout(speaking.timer);
    speaking?.resolve();
  }

  dispose(): void {
    this.stop();
  }
}

/** 读过的声音留在缓存目录，再读不重复花钱；空间不够时系统会清，这里也不让它无限长 */
const MAX_CACHED_FILES = 400;

function speechDir(): Directory {
  const dir = new Directory(Paths.cache, "speech");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function trimCache(): void {
  try {
    const files = speechDir()
      .list()
      .filter((entry): entry is File => entry instanceof File);
    if (files.length <= MAX_CACHED_FILES) return;
    files
      .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
      .slice(0, files.length - MAX_CACHED_FILES / 2)
      .forEach((file) => file.delete());
  } catch {
    // 清不掉也不影响读
  }
}

export class ServiceVoice implements AppSpeechEngine {
  private readonly player: AudioPlayer;
  private readonly loader: AudioLoader<string>;
  private readonly routeId: string;
  private finish: (() => void) | null = null;
  private speaking = 0;

  constructor(api: Api, routeId: string) {
    this.routeId = routeId;
    this.player = createAudioPlayer(null);
    trimCache();
    this.loader = new AudioLoader<string>(
      async (key, line) => {
        const dir = speechDir();
        for (const ext of ["mp3", "wav"]) {
          const known = new File(dir, `${key}.${ext}`);
          if (known.exists) return known.uri;
        }
        const { data, mime } = await api.speech.synthesize({
          text: line.text,
          route_id: routeId,
          ...(line.voice ? { voice: line.voice } : {}),
        });
        const file = new File(dir, `${key}.${mime.includes("wav") ? "wav" : "mp3"}`);
        file.create({ overwrite: true });
        file.write(new Uint8Array(data));
        return file.uri;
      },
      () => undefined,
    );
  }

  prepare(line: SpeechLine): void {
    void this.loader.get(speechCacheKey(this.routeId, line), line).catch(() => undefined);
  }

  async speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void> {
    this.speaking += 1;
    const speaking = this.speaking;
    const uri = await this.loader.get(speechCacheKey(this.routeId, line), line);
    if (speaking !== this.speaking) return; // 等声音的时候被停了
    const { player } = this;
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => {
        cleanup();
        reject(new SpeechFailure("bad_response"));
      }, START_TIMEOUT_MS);
      const listener = (status: AudioStatus): void => {
        if (status.playing && !started) {
          started = true;
          clearTimeout(timer);
          onStart();
        }
        if (status.didJustFinish) {
          cleanup();
          resolve();
        }
      };
      const subscription = player.addListener("playbackStatusUpdate", listener);
      const cleanup = (): void => {
        clearTimeout(timer);
        subscription.remove();
      };
      this.finish = () => {
        cleanup();
        resolve();
      };
      player.replace({ uri });
      player.setPlaybackRate(rate, "high");
      player.play();
    });
  }

  setRate(rate: number): void {
    this.player.setPlaybackRate(rate, "high");
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.play();
  }

  stop(): void {
    this.speaking += 1;
    this.player.pause();
    this.finish?.();
    this.finish = null;
  }

  dispose(): void {
    this.stop();
    this.player.remove();
  }
}
