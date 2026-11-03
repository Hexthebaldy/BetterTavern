/**
 * 朗读的界面（docs/speech.md 第 6 节）：
 * - SpeechBar：读的时候浮在操作栏上面的一条，写读到第几段，有暂停、下一段、停止；读不出来时写原因，带“重试”；
 * - SpeechSheet：朗读设置（声音从哪来、旁白和对白的声音、语速、自动朗读、试听），设置页和阅读页的“更多”共用；
 *   多角色的局里（阅读页）多一块每个角色的声音。设置存在这台设备上。
 */

import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { CastMember } from "@bettertavern/core/api/types";
import { currentLanguage, i18n, type Language } from "@bettertavern/core/i18n/index";
import {
  choiceOf,
  DEVICE_SOURCE,
  SPEECH_RATES,
  withCastVoice,
  withVoice,
  type SpeechLine,
} from "@bettertavern/core/play/speech";
import { speechErrorKey, speechReason, type SpeechReason } from "@bettertavern/core/play/speechPlayer";

import { Button, Chip, Icon, IconButton, Notice, RadioMark, Sheet, Toggle } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { comicDepth, comicRadius, comicStroke, hardShadow, space, useComic } from "../../theme/index.ts";
import { DeviceVoice, ServiceVoice, type AppSpeechEngine } from "./speechEngines.ts";
import { useSpeechPrefs } from "./speechPrefs.ts";
import { useSpeechServices, useSpeechSource, type SpeechControls } from "./useSpeech.ts";

export function SpeechBar({
  speech,
  seq,
  bottom,
}: {
  speech: SpeechControls;
  /** 正在读的回合是第几回合；开场是 0 */
  seq: number | null;
  /** 距离阅读区底部多远（操作栏的高度） */
  bottom: number;
}) {
  const c = useComic();
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
  const failed = state.status === "failed";
  const label = (): string => {
    if (failed && state.reason) return t(speechErrorKey(state.reason));
    if (state.status === "waiting") return t("play.speech.waiting");
    if (slow) return t("play.speech.loading");
    const place = { paragraph: state.paragraph, total: state.paragraphs };
    return seq === 0 || seq === null
      ? t("play.speech.progressOpening", place)
      : t("play.speech.progress", { seq, ...place });
  };
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.bar,
        {
          bottom: bottom + space.s,
          borderColor: c.ink,
          backgroundColor: c.paper,
          boxShadow: hardShadow(c.ink, comicDepth.focus),
        },
      ]}
    >
      {failed ? (
        <Chip small label={t("common.retry")} onPress={speech.retry} />
      ) : state.status === "paused" ? (
        <IconButton icon="play" label={t("play.speech.resume")} onPress={speech.resume} />
      ) : (
        <IconButton
          icon="pause"
          label={t("play.speech.pause")}
          disabled={slow || state.status === "waiting"}
          onPress={speech.pause}
        />
      )}
      <Text style={[styles.barText, { color: failed ? c.err : c.ink }]}>{label()}</Text>
      {failed ? null : <IconButton icon="skipNext" label={t("play.speech.next")} onPress={speech.next} />}
      <IconButton icon="close" label={t("play.speech.stop")} onPress={speech.stop} />
    </View>
  );
}

type VoiceOption = { id: string; name: string };

/** 这台设备上这种语言的声音 */
function useDeviceVoices(language: Language, enabled: boolean): VoiceOption[] {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Speech.getAvailableVoicesAsync()
      .then((list) => {
        if (!alive) return;
        setVoices(
          list
            .filter((v) => v.language.toLowerCase().startsWith(language))
            .map((v) => ({ id: v.identifier, name: v.name })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [language, enabled]);
  return voices;
}

/** 选声音的一行：点开在下面展开一张单选的列表 */
function VoiceRow({
  label,
  value,
  empty,
  voices,
  onChange,
}: {
  label: string;
  value: string | null;
  empty: string;
  voices: VoiceOption[];
  onChange: (voice: string | null) => void;
}) {
  const c = useComic();
  const [open, setOpen] = useState(false);
  const shown = value ? (voices.find((v) => v.id === value)?.name ?? value) : empty;
  const option = (id: string | null, name: string) => (
    <Pressable
      key={id ?? ""}
      accessibilityRole="radio"
      accessibilityState={{ selected: value === id }}
      onPress={() => {
        onChange(id);
        setOpen(false);
      }}
      style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.selected : "transparent" }]}
    >
      <RadioMark selected={value === id} />
      <Text numberOfLines={1} style={[styles.optionName, { color: c.ink }]}>
        {name}
      </Text>
    </Pressable>
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((now) => !now)}
        style={styles.row}
      >
        <Text style={[styles.rowName, { color: c.ink }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.rowValue, { color: c.mut }]}>
          {shown}
        </Text>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} color={c.mut} />
      </Pressable>
      {open ? (
        <View style={[styles.options, { borderColor: c.ink }]}>
          {option(null, empty)}
          {voices.map((v) => option(v.id, v.name))}
        </View>
      ) : null}
    </View>
  );
}

function TryVoice({ language, source, voice, rate }: { language: Language; source: string; voice: string | null; rate: number }) {
  const { t } = useTranslation();
  const c = useComic();
  const { api } = useApp();
  const [playing, setPlaying] = useState(false);
  const [reason, setReason] = useState<SpeechReason | null>(null);
  const engine = useRef<AppSpeechEngine | null>(null);
  useEffect(() => () => engine.current?.dispose(), []);

  const play = async (): Promise<void> => {
    engine.current?.dispose();
    const next = source === DEVICE_SOURCE ? new DeviceVoice() : new ServiceVoice(api, source);
    engine.current = next;
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
      setReason(speechReason(error));
    } finally {
      setPlaying(false);
    }
  };
  return (
    <View style={styles.tryRow}>
      {reason ? <Text style={[styles.tryError, { color: c.err }]}>{t(speechErrorKey(reason))}</Text> : null}
      <Button
        label={playing ? t("play.speech.trying") : t("play.speech.try")}
        variant="secondary"
        small
        disabled={playing}
        onPress={() => void play()}
      />
    </View>
  );
}

export function SpeechSheet({
  visible,
  onClose,
  onOpenTools,
  language,
  playthroughId,
  cast,
}: {
  visible: boolean;
  onClose: () => void;
  /** 去外部服务配语音服务 */
  onOpenTools: () => void;
  /** 这一局的语言（设备自带的声音按它筛）；设置页不传，用界面语言 */
  language?: Language;
  playthroughId?: string;
  /** 多角色的局的角色；不是多角色的局不传 */
  cast?: readonly CastMember[];
}) {
  const c = useComic();
  const { t } = useTranslation();
  const { api } = useApp();
  const [prefs, setPrefs] = useSpeechPrefs();
  const { services, loaded } = useSpeechServices();
  const source = useSpeechSource(services, loaded);
  const onDevice = source === DEVICE_SOURCE;
  const lang = language ?? currentLanguage();
  const deviceVoices = useDeviceVoices(lang, visible && onDevice);
  const [serviceVoices, setServiceVoices] = useState<VoiceOption[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || onDevice) return;
    let alive = true;
    setVoicesError(null);
    api.tools.voices(source).then(
      (list) => alive && setServiceVoices(list),
      (error: unknown) => alive && setVoicesError(describeError(error)),
    );
    return () => {
      alive = false;
    };
  }, [api, visible, onDevice, source]);
  const voices = onDevice ? deviceVoices : serviceVoices;
  const choice = choiceOf(prefs, source);

  return (
    <Sheet visible={visible} onClose={onClose} title={t("play.speech.settings")}>
      <ScrollView contentContainerStyle={styles.sheet}>
        <Text style={[styles.rowName, { color: c.ink }]}>{t("play.speech.source")}</Text>
        <View style={styles.chips}>
          <Chip
            small
            label={t("play.speech.device")}
            selected={onDevice}
            onPress={() => setPrefs((p) => ({ ...p, source: DEVICE_SOURCE }))}
          />
          {services.map((route) => (
            <Chip
              key={route.id}
              small
              label={route.label || t(`tools.providers.${route.provider as "tavily"}`, { defaultValue: route.provider })}
              selected={source === route.id}
              onPress={() => setPrefs((p) => ({ ...p, source: route.id }))}
            />
          ))}
        </View>
        <Text style={[styles.note, { color: c.mut }]}>
          {onDevice ? t("play.speech.deviceNote") : t("play.speech.serviceNote")}
        </Text>
        {loaded && services.length === 0 ? (
          <Pressable accessibilityRole="link" onPress={onOpenTools} hitSlop={8}>
            <Text style={[styles.link, { color: c.acc }]}>{t("play.speech.addService")}</Text>
          </Pressable>
        ) : null}
        {onDevice && deviceVoices.length === 0 ? (
          <Text style={[styles.note, { color: c.mut }]}>{t("play.speech.noDeviceVoice")}</Text>
        ) : null}
        {voicesError && !onDevice ? <Notice message={t("play.speech.voicesFailed")} /> : null}
        <VoiceRow
          label={t("play.speech.narrator")}
          value={choice.narrator}
          empty={t("play.speech.defaultVoice")}
          voices={voices}
          onChange={(voice) => setPrefs((p) => withVoice({ ...p, source }, "narrator", voice))}
        />
        <VoiceRow
          label={t("play.speech.dialogue")}
          value={choice.dialogue}
          empty={t("play.speech.sameAsNarrator")}
          voices={voices}
          onChange={(voice) => setPrefs((p) => withVoice({ ...p, source }, "dialogue", voice))}
        />
        {cast && cast.length > 1 && playthroughId ? (
          <View style={styles.block}>
            <Text style={[styles.rowName, { color: c.ink }]}>{t("play.speech.cast")}</Text>
            <Text style={[styles.note, { color: c.mut }]}>{t("play.speech.castNote")}</Text>
            {cast.map((member) => (
              <VoiceRow
                key={member.position}
                label={member.name}
                value={choice.cast[playthroughId]?.[String(member.position)] ?? null}
                empty={t("play.speech.sameAsDialogue")}
                voices={voices}
                onChange={(voice) =>
                  setPrefs((p) => withCastVoice({ ...p, source }, playthroughId, member.position, voice))
                }
              />
            ))}
          </View>
        ) : null}
        <Text style={[styles.rowName, { color: c.ink }]}>{t("play.speech.rate")}</Text>
        <View style={styles.chips}>
          {SPEECH_RATES.map((rate) => (
            <Chip
              key={rate}
              small
              label={t("play.speech.rateValue", { rate })}
              selected={prefs.rate === rate}
              onPress={() => setPrefs((p) => ({ ...p, rate }))}
            />
          ))}
        </View>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowName, { color: c.ink }]}>{t("play.speech.auto")}</Text>
            <Text style={[styles.note, { color: c.mut }]}>{t("play.speech.autoNote")}</Text>
          </View>
          <Toggle
            value={prefs.auto}
            label={t("play.speech.auto")}
            onChange={(auto) => setPrefs((p) => ({ ...p, auto }))}
          />
        </View>
        <TryVoice language={lang} source={source} voice={choice.narrator} rate={prefs.rate} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: space.m,
    right: space.m,
    alignSelf: "center",
    maxWidth: 560,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 48,
    paddingHorizontal: space.s,
    paddingVertical: 4,
    borderWidth: comicStroke.control,
    borderRadius: comicRadius.frame,
  },
  barText: { flex: 1, fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  sheet: { gap: 12, paddingHorizontal: 18, paddingBottom: space.l },
  block: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  note: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 14, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14.5, fontWeight: "700" },
  rowValue: { flex: 1, textAlign: "right", fontSize: 13.5 },
  options: { borderWidth: comicStroke.chip, borderRadius: 12, overflow: "hidden", marginBottom: space.s },
  option: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 44, paddingHorizontal: space.m },
  optionName: { flex: 1, fontSize: 14.5 },
  tryRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.m },
  tryError: { flex: 1, fontSize: 13, lineHeight: 18 },
});
