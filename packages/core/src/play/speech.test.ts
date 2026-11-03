import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  chopText,
  DEFAULT_SPEECH,
  effectiveSource,
  EMPTY_CHOICE,
  parseSpeechPrefs,
  speechCacheKey,
  speechLines,
  withCastVoice,
  withVoice,
  type SpeechContext,
  type VoiceChoice,
} from "./speech.ts";

function context(choice: Partial<VoiceChoice> = {}, maxChars = 300): SpeechContext {
  return { choice: { ...EMPTY_CHOICE, ...choice }, playthroughId: "p1", language: "zh", maxChars };
}

const texts = (lines: { text: string }[]): string[] => lines.map((l) => l.text);

test("按段落切，每一小段记着是第几段", () => {
  const lines = speechLines({ narrative: "第一段。\n\n第二段。\n", segments: [] }, context(), true);
  assert.deepEqual(texts(lines), ["第一段。", "第二段。"]);
  assert.deepEqual(
    lines.map((l) => l.spot),
    ["0:0", "0:1"],
  );
  assert.equal(lines[0]?.voice, null);
  assert.equal(lines[0]?.language, "zh");
});

test("对白和旁白一样的声音时，不把引号切开", () => {
  const narrative = "沈知微接过灯。“前面就是渡口了。”她说。";
  assert.deepEqual(texts(speechLines({ narrative, segments: [] }, context({ narrator: "a" }), true)), [narrative]);
  // 对白的声音选的就是旁白的声音：一样不切
  const same = context({ narrator: "a", dialogue: "a" });
  assert.deepEqual(texts(speechLines({ narrative, segments: [] }, same, true)), [narrative]);
});

test("对白换一个声音时，引号里的话单独切出来，去掉引号", () => {
  const narrative = "沈知微接过灯。“前面就是渡口了，”她回头看了一眼，“你在这里等我。”";
  const lines = speechLines({ narrative, segments: [] }, context({ narrator: "n", dialogue: "d" }), true);
  assert.deepEqual(
    lines.map((l) => [l.text, l.voice]),
    [
      ["沈知微接过灯。", "n"],
      ["前面就是渡口了，", "d"],
      ["她回头看了一眼，", "n"],
      ["你在这里等我。", "d"],
    ],
  );
  assert.ok(lines.every((l) => l.spot === "0:0"));
});

test("认得日文引号、英文引号，没写完的引号算对白", () => {
  const choice = context({ narrator: "n", dialogue: "d" });
  const voices = (narrative: string) =>
    speechLines({ narrative, segments: [] }, choice, true).map((l) => [l.text, l.voice]);
  assert.deepEqual(voices("彼は言った。「待て」"), [
    ["彼は言った。", "n"],
    ["待て", "d"],
  ]);
  assert.deepEqual(voices('He said, "Wait here." It\'s late.'), [
    ["He said,", "n"],
    ["Wait here.", "d"],
    ["It's late.", "n"],
  ]);
  assert.deepEqual(voices("她说：“别走"), [
    ["她说：", "n"],
    ["别走", "d"],
  ]);
});

test("没有能读的字的不读，排版记号去掉", () => {
  const lines = speechLines(
    { narrative: "……\n——\n**他走了**。\n“……”她说。", segments: [] },
    context({ narrator: "n", dialogue: "d" }),
    true,
  );
  assert.deepEqual(
    lines.map((l) => [l.text, l.spot]),
    [
      ["他走了。", "0:2"],
      ["她说。", "0:3"],
    ],
  );
});

test("一段太长时在句子结尾切，尽量多的句子放在一起", () => {
  assert.deepEqual(chopText("一二三。四五六！七八九？", 8), ["一二三。四五六！", "七八九？"]);
  assert.deepEqual(chopText("短的", 8), ["短的"]);
  // 收尾的引号和句子放在一起
  assert.deepEqual(chopText("他说：“走吧。”然后走了。又回来了。", 10), ["他说：“走吧。”", "然后走了。又回来了。"]);
  // 英文的句点后面有空白才算结尾
  assert.deepEqual(chopText("Pi is 3.14 ok. Next one here.", 16), ["Pi is 3.14 ok.", " Next one here."]);
});

test("一句太长时在逗号处切，还太长就硬切，每一节都不超过上限", () => {
  assert.deepEqual(chopText("一二三四五，六七八九十，甲乙丙丁戊", 6), ["一二三四五，", "六七八九十，", "甲乙丙丁戊"]);
  const hard = chopText("字".repeat(25), 10);
  assert.deepEqual(
    hard.map((p) => p.length),
    [10, 10, 5],
  );
});

test("长段落切开以后还是同一段的位置", () => {
  const narrative = `${"一句话。".repeat(100)}\n第二段。`;
  const lines = speechLines({ narrative, segments: [] }, context({}, 120), true);
  assert.ok(lines.length > 3);
  assert.ok(lines.every((l) => l.text.length <= 120));
  assert.equal(lines[lines.length - 1]?.spot, "0:1");
  assert.ok(lines.slice(0, -1).every((l) => l.spot === "0:0"));
});

test("回合还在写时，最后一段要等换行才算写完，前面切好的不变", () => {
  const turn = (narrative: string) => ({ narrative, segments: [] });
  assert.deepEqual(texts(speechLines(turn("第一段还没写"), context(), false)), []);
  assert.deepEqual(texts(speechLines(turn("第一段写完。\n第二段还"), context(), false)), ["第一段写完。"]);
  assert.deepEqual(texts(speechLines(turn("第一段写完。\n第二段写完。\n"), context(), false)), [
    "第一段写完。",
    "第二段写完。",
  ]);
  assert.deepEqual(texts(speechLines(turn("第一段写完。\n第二段还"), context(), true)), ["第一段写完。", "第二段还"]);
});

test("多角色的局：引号里的话用他的声音，引号外用旁白的声音；旁白那一段的对白用对白的声音", () => {
  const segments = [
    { speaker: null, text: "雨停了。“有人吗？”门外有人喊。" },
    { speaker: 0, text: "阿苓抬起头。“来了。”" },
    { speaker: 1, text: "老周没说话。“唉。”" },
  ];
  const lines = speechLines(
    { narrative: "忽略", segments },
    context({ narrator: "n", dialogue: "d", cast: { p1: { "0": "aling" } } }),
    true,
  );
  assert.deepEqual(
    lines.map((l) => [l.text, l.voice, l.spot]),
    [
      ["雨停了。", "n", "0:0"],
      ["有人吗？", "d", "0:0"],
      ["门外有人喊。", "n", "0:0"],
      ["阿苓抬起头。", "n", "1:0"],
      ["来了。", "aling", "1:0"],
      ["老周没说话。", "n", "2:0"],
      ["唉。", "d", "2:0"],
    ],
  );
});

test("多角色的局：只给角色选了声音时，只有他那一段切开；别的局的声音不算", () => {
  const segments = [
    { speaker: 0, text: "阿苓说：“来了。”" },
    { speaker: 1, text: "老周说：“唉。”" },
  ];
  const lines = speechLines(
    { narrative: "", segments },
    context({ cast: { p1: { "0": "aling" }, other: { "1": "zhou" } } }),
    true,
  );
  assert.deepEqual(
    lines.map((l) => [l.text, l.voice]),
    [
      ["阿苓说：", null],
      ["来了。", "aling"],
      ["老周说：“唉。”", null],
    ],
  );
});

test("多角色的局还在写：只有最后一个人的最后一段算没写完", () => {
  const segments = [
    { speaker: 0, text: "阿苓说完了" },
    { speaker: 1, text: "老周写完了一段。\n老周还" },
  ];
  assert.deepEqual(
    speechLines({ narrative: "", segments }, context(), false).map((l) => [l.text, l.spot]),
    [
      ["阿苓说完了", "0:0"],
      ["老周写完了一段。", "1:0"],
    ],
  );
});

test("朗读设置读到不对的内容时用默认值", () => {
  assert.deepEqual(parseSpeechPrefs(null), DEFAULT_SPEECH);
  assert.deepEqual(parseSpeechPrefs({ source: 3, rate: 7, auto: "yes", voices: "x" }), DEFAULT_SPEECH);
  const parsed = parseSpeechPrefs({
    source: "route-1",
    rate: 1.25,
    auto: true,
    voices: {
      "route-1": { narrator: "a", dialogue: "", cast: { p1: { "0": "b", "1": 3 }, p2: "x", p3: { "0": "" } } },
      bad: 1,
    },
  });
  assert.deepEqual(parsed, {
    source: "route-1",
    rate: 1.25,
    auto: true,
    voices: { "route-1": { narrator: "a", dialogue: null, cast: { p1: { "0": "b" } } } },
  });
});

test("每个来源各记各的声音", () => {
  let prefs = withVoice(DEFAULT_SPEECH, "narrator", "婷婷");
  prefs = withVoice({ ...prefs, source: "route-1" }, "narrator", "alloy");
  prefs = withVoice(prefs, "dialogue", "coral");
  assert.equal(prefs.voices.device?.narrator, "婷婷");
  assert.deepEqual(prefs.voices["route-1"], { narrator: "alloy", dialogue: "coral", cast: {} });
});

test("角色的声音按局记，清掉以后不留空壳", () => {
  let prefs = withCastVoice(DEFAULT_SPEECH, "p1", 0, "aling");
  prefs = withCastVoice(prefs, "p1", 1, "zhou");
  assert.deepEqual(prefs.voices.device?.cast, { p1: { "0": "aling", "1": "zhou" } });
  prefs = withCastVoice(prefs, "p1", 0, null);
  prefs = withCastVoice(prefs, "p1", 1, null);
  assert.deepEqual(prefs.voices.device?.cast, {});
});

test("选的服务被删了时退回设备自带的声音", () => {
  const prefs = { ...DEFAULT_SPEECH, source: "route-1" };
  assert.equal(effectiveSource(prefs, ["route-1"]), "route-1");
  assert.equal(effectiveSource(prefs, []), "device");
  assert.equal(effectiveSource(DEFAULT_SPEECH, ["route-1"]), "device");
});

test("缓存的键：文字、声音、来源有一个不同就不同", () => {
  const key = speechCacheKey("r1", { text: "你好", voice: "a" });
  assert.equal(key, speechCacheKey("r1", { text: "你好", voice: "a" }));
  assert.notEqual(key, speechCacheKey("r2", { text: "你好", voice: "a" }));
  assert.notEqual(key, speechCacheKey("r1", { text: "你好", voice: "b" }));
  assert.notEqual(key, speechCacheKey("r1", { text: "你好！", voice: "a" }));
  assert.match(key, /^[a-z0-9-]+$/);
});
