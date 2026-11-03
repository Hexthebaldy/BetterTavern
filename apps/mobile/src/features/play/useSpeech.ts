/**
 * 阅读页的朗读（docs/speech.md）：一个 SpeechPlayer 和一个 TurnReader，跟着阅读页的状态走。
 * 声音来源换了就换出声的方式；离开页面、App 退到后台就停（第一版不做后台播放）。
 */

import { setAudioModeAsync } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import type { ToolRoute } from "@bettertavern/core/api/types";
import {
  choiceOf,
  DEVICE_PIECE_CHARS,
  DEVICE_SOURCE,
  effectiveSource,
  SERVICE_PIECE_CHARS,
  type SpeechContext,
} from "@bettertavern/core/play/speech";
import { SpeechPlayer, TurnReader, type SpeechState } from "@bettertavern/core/play/speechPlayer";
import type { PlayState, StoryTurn } from "@bettertavern/core/play/turnMachine";

import { useAsync } from "../../hooks/useAsync.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { DeviceVoice, ServiceVoice } from "./speechEngines.ts";
import { useSpeechPrefs } from "./speechPrefs.ts";

export type SpeechControls = {
  state: SpeechState;
  read: (turn: StoryTurn) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  stop: () => void;
  retry: () => void;
};

/** 配好的朗读服务 */
export function useSpeechServices(): { services: ToolRoute[]; loaded: boolean; reload: () => void } {
  const { api } = useApp();
  const { data, reload } = useAsync(() => api.tools.list(), [api]);
  const services = useMemo(() => (data ?? []).filter((r) => r.kind === "speech"), [data]);
  return { services, loaded: data !== undefined, reload: () => void reload() };
}

/** 选的服务被删了时退回设备自带的声音；列表还没读回来时先按存着的 */
export function useSpeechSource(services: readonly ToolRoute[], loaded: boolean): string {
  const [prefs] = useSpeechPrefs();
  return loaded
    ? effectiveSource(
        prefs,
        services.map((r) => r.id),
      )
    : prefs.source;
}

export function useSpeech(playState: PlayState, playthroughId: string): SpeechControls {
  const { api } = useApp();
  const [prefs] = useSpeechPrefs();
  const { services, loaded } = useSpeechServices();
  const source = useSpeechSource(services, loaded);
  const engine = useMemo(
    () => (source === DEVICE_SOURCE ? new DeviceVoice() : new ServiceVoice(api, source)),
    [api, source],
  );

  const context = useRef<SpeechContext | null>(null);
  context.current = {
    choice: choiceOf(prefs, source),
    playthroughId,
    language: playState.language,
    maxChars: source === DEVICE_SOURCE ? DEVICE_PIECE_CHARS : SERVICE_PIECE_CHARS,
  };

  const created = useRef<{ player: SpeechPlayer; reader: TurnReader } | null>(null);
  if (created.current === null) {
    const player = new SpeechPlayer(engine);
    created.current = { player, reader: new TurnReader(player, () => context.current as SpeechContext) };
  }
  const { player, reader } = created.current;

  useEffect(() => {
    player.setEngine(engine);
    return () => engine.dispose();
  }, [player, engine]);

  useEffect(() => {
    // 手机静音键打开时也要出声：这是玩家点了才放的内容
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") player.stop();
    });
    return () => {
      subscription.remove();
      player.stop();
    };
  }, [player]);

  useEffect(() => player.setRate(prefs.rate), [player, prefs.rate]);
  useEffect(() => reader.sync(playState, prefs.auto), [reader, playState, prefs.auto]);

  const state = useSyncExternalStore(player.subscribe, player.getState);

  const read = useCallback((turn: StoryTurn) => reader.read(turn.id, turn), [reader]);
  const pause = useCallback(() => player.pause(), [player]);
  const resume = useCallback(() => player.resume(), [player]);
  const next = useCallback(() => player.next(), [player]);
  const stop = useCallback(() => player.stop(), [player]);
  const retry = useCallback(() => player.retry(), [player]);
  return { state, read, pause, resume, next, stop, retry };
}
