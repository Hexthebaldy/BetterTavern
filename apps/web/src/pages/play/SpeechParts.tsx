/**
 * 朗读的界面（docs/speech.md 第 6 节）：
 * - SpeechBar：读的时候浮在页面底部的一条，写读到第几段，有暂停、下一段、停止；读不出来时写原因，带“再试一次”；
 * - SpeechSettings：朗读设置（声音从哪来、旁白和对白的声音、语速、自动朗读、试听），设置页和阅读页的对话框共用；
 *   多角色的局里（阅读页）多一块每个角色的声音。设置存在这台设备上。
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { CastMember } from "@bettertavern/core/api/types";
import { i18n, LANGUAGE_TAGS, type Language } from "@bettertavern/core/i18n/index";
import {
  choiceOf,
  DEVICE_SOURCE,
  SPEECH_RATES,
  withCastVoice,
  withVoice,
  type SpeechLine,
  type SpeechPrefs,
} from "@bettertavern/core/play/speech";
import {
  SpeechFailure,
  speechErrorKey,
  speechReason,
  type SpeechReason,
} from "@bettertavern/core/play/speechPlayer";

import { Button, Chip, cx, IconButton, Notice, Toggle } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useToolRoutes } from "../../data/tools.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import styles from "./speech.module.css";
import { BrowserVoice, ServiceVoice, type WebSpeechEngine } from "./speechEngines.ts";
import { useSpeechSource, type SpeechControls } from "./useSpeech.ts";

export function SpeechBar({
  speech,
  seq,
}: {
  speech: SpeechControls;
  /** 正在读的回合是第几回合；开场是 0 */
  seq: number | null;
}) {
  const { t } = useTranslation();
  const { state } = speech;
  // 小段之间也会短暂地“在等声音”：等得久才说，否则字一闪一闪
  const [slow, setSlow] = useState(false);
  const loading = state.status === "loading";
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 700);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [loading]);
  if (state.status === "idle") return null;
  const label = (): string => {
    if (state.status === "failed" && state.reason) return t(speechErrorKey(state.reason));
    if (state.status === "waiting") return t("play.speech.waiting");
    if (slow) return t("play.speech.loading");
    const place = { paragraph: state.paragraph, total: state.paragraphs };
    return seq === 0 || seq === null
      ? t("play.speech.progressOpening", place)
      : t("play.speech.progress", { seq, ...place });
  };
  const failed = state.status === "failed";
  return (
    <div className={styles.bar} role="status">
      {failed ? (
        <Button label={t("common.retry")} size="sm" variant="secondary" onClick={speech.retry} />
      ) : state.status === "paused" ? (
        <IconButton icon="play" label={t("play.speech.resume")} tone="plain" onClick={speech.resume} />
      ) : (
        <IconButton
          icon="pause"
          label={t("play.speech.pause")}
          tone="plain"
          disabled={slow || state.status === "waiting"}
          onClick={speech.pause}
        />
      )}
      <span className={cx(styles.barText, failed && styles.barFailed)}>{label()}</span>
      {failed ? null : (
        <IconButton icon="skipNext" label={t("play.speech.next")} tone="plain" onClick={speech.next} />
      )}
      <IconButton icon="close" label={t("play.speech.stop")} tone="plain" onClick={speech.stop} />
    </div>
  );
}

type VoiceOption = { id: string; name: string };

/** 这台设备上这种语言的声音（浏览器要等一会儿才给全） */
function useDeviceVoices(language: Language): VoiceOption[] {
  const read = (): SpeechSynthesisVoice[] => window.speechSynthesis?.getVoices() ?? [];
  const [voices, setVoices] = useState(read);
  useEffect(() => {
    const synth = window.speechSynthesis as SpeechSynthesis | undefined;
    if (!synth) return;
    const onChange = (): void => setVoices(read());
    synth.addEventListener("voiceschanged", onChange);
    return () => synth.removeEventListener("voiceschanged", onChange);
  }, []);
  return useMemo(
    () =>
      voices
        .filter((v) => v.lang.toLowerCase().startsWith(language))
        .map((v) => ({ id: v.voiceURI, name: v.name })),
    [voices, language],
  );
}

function VoiceSelect({
  label,
  value,
  empty,
  voices,
  onChange,
}: {
  label: ReactNode;
  value: string | null;
  /** 没选时显示什么（默认、和旁白一样……） */
  empty: string;
  voices: VoiceOption[];
  onChange: (voice: string | null) => void;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.rowName}>{label}</span>
      <span className={styles.selectBox}>
        <select className={styles.select} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{empty}</option>
          {value && !voices.some((v) => v.id === value) ? <option value={value}>{value}</option> : null}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <Icon name="down" size={16} strokeWidth={2.2} />
      </span>
    </label>
  );
}

export function SpeechSettings({
  language,
  playthroughId,
  cast,
}: {
  /** 这一局的语言（设备自带的声音按它筛）；设置页用界面语言 */
  language: Language;
  playthroughId?: string;
  /** 多角色的局的角色；不是多角色的局不传 */
  cast?: readonly CastMember[];
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const { speech: prefs, setSpeech } = usePrefs();
  const routes = useToolRoutes();
  const services = (routes.data ?? []).filter((r) => r.kind === "speech");
  const source = useSpeechSource();
  const onDevice = source === DEVICE_SOURCE;
  const deviceVoices = useDeviceVoices(language);
  const serviceVoices = useQuery({
    queryKey: ["speech-voices", source],
    queryFn: () => api.tools.voices(source),
    enabled: !onDevice,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const voices = onDevice ? deviceVoices : (serviceVoices.data ?? []);
  const choice = choiceOf(prefs, source);
  const set = (change: (current: SpeechPrefs) => SpeechPrefs): void => setSpeech(change);

  return (
    <div className={styles.settings}>
      <div className={styles.block}>
        <span className={styles.rowName}>{t("play.speech.source")}</span>
        <div className={styles.chips} role="radiogroup" aria-label={t("play.speech.source")}>
          <Chip
            label={t("play.speech.device")}
            selected={onDevice}
            onClick={() => set((p) => ({ ...p, source: DEVICE_SOURCE }))}
          />
          {services.map((route) => (
            <Chip
              key={route.id}
              label={route.label || t(`tools.providers.${route.provider as "tavily"}`, { defaultValue: route.provider })}
              selected={source === route.id}
              onClick={() => set((p) => ({ ...p, source: route.id }))}
            />
          ))}
        </div>
        <p className={styles.note}>
          {onDevice ? t("play.speech.deviceNote") : t("play.speech.serviceNote")}
          {services.length === 0 ? (
            <>
              {" "}
              <Link to="/settings/tools" className={styles.link}>
                {t("play.speech.addService")}
              </Link>
            </>
          ) : null}
        </p>
        {onDevice && deviceVoices.length === 0 ? <p className={styles.note}>{t("play.speech.noDeviceVoice")}</p> : null}
        {serviceVoices.error && !onDevice ? <Notice message={t("play.speech.voicesFailed")} /> : null}
      </div>
      <VoiceSelect
        label={t("play.speech.narrator")}
        value={choice.narrator}
        empty={t("play.speech.defaultVoice")}
        voices={voices}
        onChange={(voice) => set((p) => withVoice({ ...p, source }, "narrator", voice))}
      />
      <VoiceSelect
        label={t("play.speech.dialogue")}
        value={choice.dialogue}
        empty={t("play.speech.sameAsNarrator")}
        voices={voices}
        onChange={(voice) => set((p) => withVoice({ ...p, source }, "dialogue", voice))}
      />
      {cast && cast.length > 1 && playthroughId ? (
        <div className={styles.block}>
          <span className={styles.rowName}>{t("play.speech.cast")}</span>
          <p className={styles.note}>{t("play.speech.castNote")}</p>
          {cast.map((member) => (
            <VoiceSelect
              key={member.position}
              label={member.name}
              value={choice.cast[playthroughId]?.[String(member.position)] ?? null}
              empty={t("play.speech.sameAsDialogue")}
              voices={voices}
              onChange={(voice) => set((p) => withCastVoice({ ...p, source }, playthroughId, member.position, voice))}
            />
          ))}
        </div>
      ) : null}
      <label className={styles.row}>
        <span className={styles.rowName}>{t("play.speech.rate")}</span>
        <span className={styles.selectBox}>
          <select
            className={styles.select}
            value={prefs.rate}
            onChange={(e) => set((p) => ({ ...p, rate: Number(e.target.value) }))}
          >
            {SPEECH_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {t("play.speech.rateValue", { rate })}
              </option>
            ))}
          </select>
          <Icon name="down" size={16} strokeWidth={2.2} />
        </span>
      </label>
      <label className={styles.row}>
        <span className={styles.rowText}>
          <span className={styles.rowName}>{t("play.speech.auto")}</span>
          <span className={styles.note}>{t("play.speech.autoNote")}</span>
        </span>
        <Toggle checked={prefs.auto} onChange={(auto) => set((p) => ({ ...p, auto }))} aria-label={t("play.speech.auto")} />
      </label>
      <TryVoice language={language} source={source} voice={choice.narrator} rate={prefs.rate} />
    </div>
  );
}

function TryVoice({
  language,
  source,
  voice,
  rate,
}: {
  language: Language;
  source: string;
  voice: string | null;
  rate: number;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const [playing, setPlaying] = useState(false);
  const [reason, setReason] = useState<SpeechReason | null>(null);
  const engine = useRef<WebSpeechEngine | null>(null);
  useEffect(() => () => engine.current?.dispose(), []);

  const play = async (): Promise<void> => {
    engine.current?.dispose();
    const next = source === DEVICE_SOURCE ? new BrowserVoice() : new ServiceVoice(api, source);
    engine.current = next;
    next.unlock();
    setPlaying(true);
    setReason(null);
    const line: SpeechLine = {
      text: i18n.t("play.speech.sample", { lng: language }),
      voice,
      language,
      spot: "0:0",
    };
    try {
      await next.speak(line, rate, () => undefined);
    } catch (error) {
      setReason(error instanceof SpeechFailure ? error.reason : speechReason(error));
    } finally {
      setPlaying(false);
    }
  };
  return (
    <div className={styles.tryRow}>
      {reason ? <span className={styles.barFailed}>{t(speechErrorKey(reason))}</span> : null}
      <Button
        label={playing ? t("play.speech.trying") : t("play.speech.try")}
        icon="play"
        size="sm"
        variant="secondary"
        disabled={playing}
        onClick={() => void play()}
      />
    </div>
  );
}

export function SpeechDialog({
  language,
  playthroughId,
  cast,
  onClose,
}: {
  language: Language;
  playthroughId: string;
  cast: readonly CastMember[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog label={t("play.speech.settings")} onClose={onClose} width={480}>
      <h2 className={styles.title} lang={LANGUAGE_TAGS[language]}>
        {t("play.speech.settings")}
      </h2>
      <SpeechSettings language={language} playthroughId={playthroughId} cast={cast} />
      <div className={styles.dialogButtons}>
        <Button label={t("common.done")} onClick={onClose} />
      </div>
    </Dialog>
  );
}

