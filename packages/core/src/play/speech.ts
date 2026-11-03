/**
 * 朗读的规则（docs/speech.md）：朗读设置，把一回合切成一小段一小段，每一小段用哪个声音。
 *
 * 切法：按段落切（和界面上的段落一一对应，读到哪一段就标哪一段）；一段太长在句子结尾再切；
 * 对白和旁白不是同一个声音时，引号里的话单独切出来。没有能读的字的（比如只有“……”）不读。
 * 多角色的局（docs/cast.md）：每个人写的那一段分开切，引号里的话用他的声音，引号外的用旁白的声音。
 */

import type { Playthrough, Segment } from "../api/types.ts";

/** 声音来源：设备自带的；否则是朗读服务（tool_routes）的 id */
export const DEVICE_SOURCE = "device";
export const SPEECH_RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
/** 用服务时一小段最多多少字（服务端的上限是 1000）；再长了等得久 */
export const SERVICE_PIECE_CHARS = 300;
/** 设备自带的声音一小段最多多少字：Chrome 的在线声音读十几秒就会断 */
export const DEVICE_PIECE_CHARS = 120;

export type VoiceChoice = {
  /** 旁白的声音；null 是这个来源默认的声音 */
  narrator: string | null;
  /** 对白的声音；null 是和旁白一样 */
  dialogue: string | null;
  /** 多角色的局里每个角色的声音：局的 id → 角色的位置 → 声音 */
  cast: Record<string, Record<string, string>>;
};

/** 存在设备上：设备自带的声音每台设备不一样 */
export type SpeechPrefs = {
  source: string;
  rate: number;
  /** 自动朗读新回合 */
  auto: boolean;
  /** 每个来源各记各的声音 */
  voices: Record<string, VoiceChoice>;
};

export const EMPTY_CHOICE: VoiceChoice = { narrator: null, dialogue: null, cast: {} };
export const DEFAULT_SPEECH: SpeechPrefs = { source: DEVICE_SOURCE, rate: 1, auto: false, voices: {} };

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCast(raw: unknown): VoiceChoice["cast"] {
  if (typeof raw !== "object" || raw === null) return {};
  const cast: VoiceChoice["cast"] = {};
  for (const [playthrough, voices] of Object.entries(raw)) {
    if (typeof voices !== "object" || voices === null) continue;
    const kept = Object.entries(voices).filter((entry): entry is [string, string] => text(entry[1]) !== null);
    if (kept.length > 0) cast[playthrough] = Object.fromEntries(kept);
  }
  return cast;
}

export function parseSpeechPrefs(raw: unknown): SpeechPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SPEECH;
  const r = raw as Record<string, unknown>;
  const voices: SpeechPrefs["voices"] = {};
  if (typeof r.voices === "object" && r.voices !== null) {
    for (const [source, value] of Object.entries(r.voices)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      voices[source] = { narrator: text(v.narrator), dialogue: text(v.dialogue), cast: parseCast(v.cast) };
    }
  }
  return {
    source: text(r.source) ?? DEVICE_SOURCE,
    rate: SPEECH_RATES.includes(r.rate as (typeof SPEECH_RATES)[number]) ? (r.rate as number) : 1,
    auto: r.auto === true,
    voices,
  };
}

export function choiceOf(prefs: SpeechPrefs, source: string = prefs.source): VoiceChoice {
  return prefs.voices[source] ?? EMPTY_CHOICE;
}

export function withVoice(prefs: SpeechPrefs, role: "narrator" | "dialogue", voice: string | null): SpeechPrefs {
  const choice = choiceOf(prefs);
  return { ...prefs, voices: { ...prefs.voices, [prefs.source]: { ...choice, [role]: voice } } };
}

/** 这一局里一个角色的声音；voice 是 null 时用对白的声音 */
export function withCastVoice(
  prefs: SpeechPrefs,
  playthroughId: string,
  position: number,
  voice: string | null,
): SpeechPrefs {
  const choice = choiceOf(prefs);
  const voices = { ...choice.cast[playthroughId] };
  if (voice) voices[String(position)] = voice;
  else delete voices[String(position)];
  const cast = { ...choice.cast, [playthroughId]: voices };
  if (Object.keys(voices).length === 0) delete cast[playthroughId];
  return { ...prefs, voices: { ...prefs.voices, [prefs.source]: { ...choice, cast } } };
}

/** 选的服务被删了时退回设备自带的声音 */
export function effectiveSource(prefs: SpeechPrefs, serviceIds: readonly string[]): string {
  return serviceIds.includes(prefs.source) ? prefs.source : DEVICE_SOURCE;
}

export type SpeechLine = {
  text: string;
  /** null 是这个来源默认的声音 */
  voice: string | null;
  language: Playthrough["language"];
  /** 在正文里的位置（readingSpot）：界面标墨线用 */
  spot: string;
};

/** 第几个人写的那一段、那一段的第几段（都从 0 起；不是多角色的局 segment 是 0） */
export function readingSpot(segment: number, paragraph: number): string {
  return `${segment}:${paragraph}`;
}

export function speechParagraphs(value: string): string[] {
  return value
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const READABLE = /[\p{L}\p{N}]/u;
const QUOTES: Record<string, string> = { "“": "”", "「": "」", "『": "』", '"': '"', "＂": "＂" };
const SENTENCE_END = "。！？!?；;…";
const CLOSERS = "”」』\"＂’'）)";
const CLAUSE_END = "，,、：:";

/** 去掉排版记号（星号、反引号等）：模型偶尔写，读出来是怪声 */
function clean(value: string): string {
  return value.replace(/[*_~`#]+/g, "").trim();
}

function splitQuotes(paragraph: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let current = "";
  let close: string | null = null;
  for (const c of paragraph) {
    if (close === null && QUOTES[c]) {
      out.push({ text: current, quoted: false });
      current = "";
      close = QUOTES[c] ?? null;
    } else if (close !== null && c === close) {
      out.push({ text: current, quoted: true });
      current = "";
      close = null;
    } else {
      current += c;
    }
  }
  out.push({ text: current, quoted: close !== null }); // 没写完的引号：剩下的都算对白
  return out;
}

/** 在结尾的标点（连同紧跟着的标点和收尾的引号）后面切开 */
function splitAfter(value: string, ends: string): string[] {
  const out: string[] = [];
  let current = "";
  let ended = false;
  const chars = [...value];
  chars.forEach((c, i) => {
    if (ended && !ends.includes(c) && !CLOSERS.includes(c)) {
      out.push(current);
      current = "";
      ended = false;
    }
    current += c;
    const next = chars[i + 1];
    // 英文的句点后面要有空白才算句子结尾（3.14、e.g.）
    if (ends.includes(c) || (ends === SENTENCE_END && c === "." && (next === undefined || /\s/.test(next)))) {
      ended = true;
    }
  });
  if (current) out.push(current);
  return out;
}

/** 太长的一段切短：先在句子结尾切，一句还太长在逗号处切，还太长就硬切。尽量多的句子放在一起。 */
export function chopText(value: string, limit: number): string[] {
  if ([...value].length <= limit) return [value];
  const units: string[] = [];
  for (const sentence of splitAfter(value, SENTENCE_END)) {
    if ([...sentence].length <= limit) {
      units.push(sentence);
      continue;
    }
    for (const clause of splitAfter(sentence, CLAUSE_END)) {
      const chars = [...clause];
      for (let i = 0; i < chars.length; i += limit) units.push(chars.slice(i, i + limit).join(""));
    }
  }
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && [...current].length + [...unit].length > limit) {
      out.push(current);
      current = "";
    }
    current += unit;
  }
  if (current) out.push(current);
  return out;
}

export type SpeechTurn = { narrative: string; segments: readonly Segment[] };

export type SpeechContext = {
  choice: VoiceChoice;
  playthroughId: string;
  language: Playthrough["language"];
  /** 一小段最多多少字（SERVICE_PIECE_CHARS 或 DEVICE_PIECE_CHARS） */
  maxChars: number;
};

/**
 * 把一回合切成一小段一小段。complete 为假时回合还在写：最后一段可能没写完，要等它后面出现换行才算数。
 * 切法只看已经写完的段落，所以新写出来的只会加在后面，前面的不变。
 */
export function speechLines(turn: SpeechTurn, context: SpeechContext, complete: boolean): SpeechLine[] {
  const parts: { text: string; speaker: number | null }[] =
    turn.segments.length > 0 ? [...turn.segments] : [{ text: turn.narrative, speaker: null }];
  const { choice, playthroughId, language, maxChars } = context;
  const lines: SpeechLine[] = [];
  parts.forEach((part, segment) => {
    const open = !complete && segment === parts.length - 1 && !part.text.endsWith("\n");
    const paragraphs = speechParagraphs(part.text);
    if (open) paragraphs.pop();
    const cast = part.speaker === null ? null : choice.cast[playthroughId]?.[String(part.speaker)];
    const dialogueVoice = cast ?? choice.dialogue ?? choice.narrator;
    const separate = dialogueVoice !== choice.narrator;
    paragraphs.forEach((paragraph, index) => {
      const spot = readingSpot(segment, index);
      const chunks = separate ? splitQuotes(paragraph) : [{ text: paragraph, quoted: false }];
      for (const chunk of chunks) {
        const body = clean(chunk.text);
        if (!READABLE.test(body)) continue;
        for (const piece of chopText(body, maxChars)) {
          lines.push({
            text: piece.trim(),
            voice: chunk.quoted ? dialogueVoice : choice.narrator,
            language,
            spot,
          });
        }
      }
    });
  });
  return lines;
}

/** 同一小段文字、同一个声音的声音文件认同一个键（缓存用）。按字符串散列，不用引入加密库 */
export function speechCacheKey(source: string, line: Pick<SpeechLine, "text" | "voice">): string {
  const value = `${source}\n${line.voice ?? ""}\n${line.text}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}-${value.length}`;
}
