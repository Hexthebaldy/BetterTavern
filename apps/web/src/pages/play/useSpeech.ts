/**
 * 阅读页的朗读（docs/speech.md）：一个 SpeechPlayer 和一个 TurnReader，跟着阅读页的状态走。
 * 声音来源换了就换出声的方式；离开页面就停。
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

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

import { useToolRoutes } from "../../data/tools.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { BrowserVoice, ServiceVoice } from "./speechEngines.ts";

export type SpeechControls = {
  state: SpeechState;
  read: (turn: StoryTurn) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  stop: () => void;
  retry: () => void;
};

/** 配好的朗读服务，选的服务被删了时退回设备自带的声音；列表还没读回来时先按存着的 */
export function useSpeechSource(): string {
  const { speech } = usePrefs();
  const routes = useToolRoutes();
  return routes.data
    ? effectiveSource(
        speech,
        routes.data.filter((r) => r.kind === "speech").map((r) => r.id),
      )
    : speech.source;
}

export function useSpeech(playState: PlayState, playthroughId: string): SpeechControls {
  const { api } = useApp();
  const { speech: prefs } = usePrefs();
  const source = useSpeechSource();
  const engine = useMemo(
    () => (source === DEVICE_SOURCE ? new BrowserVoice() : new ServiceVoice(api, source)),
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

  useEffect(() => player.setRate(prefs.rate), [player, prefs.rate]);
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => reader.sync(playState, prefs.auto), [reader, playState, prefs.auto]);

  const state = useSyncExternalStore(player.subscribe, player.getState);

  const read = useCallback(
    (turn: StoryTurn) => {
      engine.unlock();
      reader.read(turn.id, turn);
    },
    [engine, reader],
  );
  const pause = useCallback(() => player.pause(), [player]);
  const resume = useCallback(() => player.resume(), [player]);
  const next = useCallback(() => player.next(), [player]);
  const stop = useCallback(() => player.stop(), [player]);
  const retry = useCallback(() => {
    engine.unlock();
    player.retry();
  }, [engine, player]);
  return { state, read, pause, resume, next, stop, retry };
}
