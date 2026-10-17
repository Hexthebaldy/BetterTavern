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
const enKeys = byBase(flatten(en as unknown as Tree));

describe("资源", () => {
  it("两种语言的 key 一一对应（复数后缀不算）", () => {
    const missing = [...zhKeys.keys()].filter((k) => !enKeys.has(k));
    const extra = [...enKeys.keys()].filter((k) => !zhKeys.has(k));
    assert.deepEqual(missing, [], "英文缺少的 key");
    assert.deepEqual(extra, [], "英文多出来的 key");
  });

  it("中文的复数只写 _other，英文对应写 _one 和 _other", () => {
    for (const [base, forms] of zhKeys) {
      if (!forms.has("other")) continue;
      assert.deepEqual([...forms.keys()], ["other"], `${base} 的中文形式`);
      assert.deepEqual([...(enKeys.get(base)?.keys() ?? [])].sort(), ["one", "other"], `${base} 的英文形式`);
    }
  });

  it("插值变量两边一致", () => {
    for (const [base, forms] of zhKeys) {
      const other = enKeys.get(base);
      assert.ok(other);
      assert.deepEqual(variables(other.values()), variables(forms.values()), base);
    }
  });

  it("文字里的组件标签（<mono>…</mono>）两边一致", () => {
    const tags = (texts: Iterable<string>): string[] => {
      const names = new Set<string>();
      for (const text of texts) for (const m of text.matchAll(/<(\w+)>/g)) names.add(m[1]!);
      return [...names].sort();
    };
    for (const [base, forms] of zhKeys)
      assert.deepEqual(tags(enKeys.get(base)!.values()), tags(forms.values()), base);
  });

  it("没有空文字；用 | 分开的选项表没有空项", () => {
    for (const [lang, keys] of [
      ["zh", zhKeys],
      ["en", enKeys],
    ] as const) {
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
  it("系统语言：中文开头的用中文，其他一律英文", () => {
    assert.equal(languageOf("zh-Hans-CN"), "zh");
    assert.equal(languageOf("zh_TW"), "zh");
    assert.equal(languageOf("ZH"), "zh");
    assert.equal(languageOf("en-US"), "en");
    assert.equal(languageOf("ja-JP"), "en");
    assert.equal(languageOf("zhx"), "en");
    assert.equal(languageOf(undefined), "en");
  });

  it("设置加上系统语言得出实际的语言", () => {
    assert.equal(resolveLanguage("system", ["zh-Hans-CN", "en-US"]), "zh");
    assert.equal(resolveLanguage("system", ["fr-FR", "zh-CN"]), "en");
    assert.equal(resolveLanguage("system", []), "en");
    assert.equal(resolveLanguage("zh", ["en-US"]), "zh");
    assert.equal(resolveLanguage("en", ["zh-CN"]), "en");
  });

  it("存储里不认识的设置退回跟随系统", () => {
    assert.equal(parseLanguageSetting("en"), "en");
    assert.equal(parseLanguageSetting("zh"), "zh");
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
    assert.equal(i18n.t("common.retry"), "重试");
    assert.equal(lookup("errors.api.NO_SUCH_CODE"), null);
    assert.equal(lookup("errors.api.EMAIL_TAKEN"), "这个邮箱已经注册过了");
  });
});
