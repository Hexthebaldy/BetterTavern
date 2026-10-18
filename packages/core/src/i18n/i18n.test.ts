import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { en } from "./en/index.ts";
import {
  applyLanguage,
  currentLanguage,
  i18n,
  languageOf,
  lookup,
  parseLanguageSetting,
  resolveLanguage,
} from "./index.ts";
import { ja } from "./ja/index.ts";
import { zh } from "./zh/index.ts";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** 去掉复数后缀后的 key → 各个形式的文字 */
function byBase(flat: Map<string, string>): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [key, value] of flat) {
    const match = PLURAL.exec(key);
    const base = match ? key.slice(0, match.index) : key;
    const forms = out.get(base) ?? new Map<string, string>();
    forms.set(match ? match[1]! : "", value);
    out.set(base, forms);
  }
  return out;
}

function variables(texts: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) names.add(m[1]!);
  names.delete("count");
  return [...names].sort();
}

const zhKeys = byBase(flatten(zh as unknown as Tree));
/** 其他语言，和每个复数 key 应有的形式：英文分单复数，日文和中文一样只有 other */
const others = [
  { lang: "en", keys: byBase(flatten(en as unknown as Tree)), plural: ["one", "other"] },
  { lang: "ja", keys: byBase(flatten(ja as unknown as Tree)), plural: ["other"] },
] as const;

describe("资源", () => {
  it("每种语言的 key 都和中文一一对应（复数后缀不算）", () => {
    for (const { lang, keys } of others) {
      const missing = [...zhKeys.keys()].filter((k) => !keys.has(k));
      const extra = [...keys.keys()].filter((k) => !zhKeys.has(k));
      assert.deepEqual(missing, [], `${lang} 缺少的 key`);
      assert.deepEqual(extra, [], `${lang} 多出来的 key`);
    }
  });

  it("中文的复数只写 _other；英文对应写 _one 和 _other，日文只写 _other", () => {
    for (const [base, forms] of zhKeys) {
      if (!forms.has("other")) continue;
      assert.deepEqual([...forms.keys()], ["other"], `${base} 的中文形式`);
      for (const { lang, keys, plural } of others)
        assert.deepEqual([...(keys.get(base)?.keys() ?? [])].sort(), [...plural], `${base} 的 ${lang} 形式`);
    }
  });

  it("插值变量和中文一致", () => {
    for (const [base, forms] of zhKeys) {
      for (const { lang, keys } of others) {
        const other = keys.get(base);
        assert.ok(other, `${lang} ${base}`);
        assert.deepEqual(variables(other.values()), variables(forms.values()), `${lang} ${base}`);
      }
    }
  });

  it("文字里的组件标签（<mono>…</mono>）和中文一致", () => {
    const tags = (texts: Iterable<string>): string[] => {
      const names = new Set<string>();
      for (const text of texts) for (const m of text.matchAll(/<(\w+)>/g)) names.add(m[1]!);
      return [...names].sort();
    };
    for (const [base, forms] of zhKeys)
      for (const { lang, keys } of others)
        assert.deepEqual(tags(keys.get(base)!.values()), tags(forms.values()), `${lang} ${base}`);
  });

  it("没有空文字；用 | 分开的选项表没有空项", () => {
    for (const [lang, keys] of [["zh", zhKeys] as const, ...others.map((o) => [o.lang, o.keys] as const)]) {
      for (const [base, forms] of keys) {
        for (const text of forms.values()) {
          assert.notEqual(text.trim(), "", `${lang} ${base}`);
          if (text.includes("|"))
            assert.ok(
              text.split("|").every((item) => item.trim() !== ""),
              `${lang} ${base}`,
            );
        }
      }
    }
  });
});

describe("语言", () => {
  it("系统语言：中文、日文开头的各用各的，其他一律英文", () => {
    assert.equal(languageOf("zh-Hans-CN"), "zh");
    assert.equal(languageOf("zh_TW"), "zh");
    assert.equal(languageOf("ZH"), "zh");
    assert.equal(languageOf("ja-JP"), "ja");
    assert.equal(languageOf("JA_jp"), "ja");
    assert.equal(languageOf("en-US"), "en");
    assert.equal(languageOf("ko-KR"), "en");
    assert.equal(languageOf("zhx"), "en");
    assert.equal(languageOf("jav"), "en");
    assert.equal(languageOf(undefined), "en");
  });

  it("设置加上系统语言得出实际的语言", () => {
    assert.equal(resolveLanguage("system", ["zh-Hans-CN", "en-US"]), "zh");
    assert.equal(resolveLanguage("system", ["fr-FR", "zh-CN"]), "en");
    assert.equal(resolveLanguage("system", []), "en");
    assert.equal(resolveLanguage("zh", ["en-US"]), "zh");
    assert.equal(resolveLanguage("en", ["zh-CN"]), "en");
    assert.equal(resolveLanguage("system", ["ja-JP", "en-US"]), "ja");
    assert.equal(resolveLanguage("ja", ["zh-CN"]), "ja");
  });

  it("存储里不认识的设置退回跟随系统", () => {
    assert.equal(parseLanguageSetting("en"), "en");
    assert.equal(parseLanguageSetting("zh"), "zh");
    assert.equal(parseLanguageSetting("ja"), "ja");
    for (const raw of ["fr", "", null, undefined, 1, {}]) assert.equal(parseLanguageSetting(raw), "system");
  });

  it("切换语言立刻生效；复数按语言选形式；缺的 key 返回 null", () => {
    assert.equal(currentLanguage(), "zh");
    assert.equal(i18n.t("time.minutesAgo", { count: 1 }), "1 分钟前");
    applyLanguage("en");
    try {
      assert.equal(currentLanguage(), "en");
      assert.equal(i18n.t("common.retry"), "Retry");
      assert.equal(i18n.t("start.avoid", { count: 1 }), "Avoid 1 item");
      assert.equal(i18n.t("start.avoid", { count: 2 }), "Avoid 2 items");
    } finally {
      applyLanguage("zh");
    }
    applyLanguage("ja");
    try {
      assert.equal(currentLanguage(), "ja");
      assert.equal(i18n.t("common.retry"), "再試行");
      // 日文没有单复数：1 和 2 都用 _other
      assert.equal(i18n.t("start.avoid", { count: 1 }), "1 件を避ける");
      assert.equal(i18n.t("start.avoid", { count: 2 }), "2 件を避ける");
      assert.equal(lookup("errors.api.EMAIL_TAKEN"), "このメールアドレスはすでに登録されています");
    } finally {
      applyLanguage("zh");
    }
    assert.equal(i18n.t("common.retry"), "重试");
    assert.equal(lookup("errors.api.NO_SUCH_CODE"), null);
    assert.equal(lookup("errors.api.EMAIL_TAKEN"), "这个邮箱已经注册过了");
  });
});
