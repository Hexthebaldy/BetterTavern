/**
 * 界面文字的多语言（见 docs/i18n.md）：手机端和网页端共用一个 i18next 实例和同一份资源。
 * 中文是源语言（zh/），其他语言的资源由它推出类型（en/、ja/）。资源打在包里，初始化是同步的。
 *
 * 组件里用 react-i18next 的 useTranslation()；core 里返回文字的纯函数在调用时用这里的 i18n.t。
 * 当前用哪种语言由两端的界面偏好决定（跟随系统 / 中文 / English / 日本語），偏好变了调用 applyLanguage()。
 */

import i18next from "i18next";

import { en } from "./en/index.ts";
import { ja } from "./ja/index.ts";
import { ensurePluralRules } from "./plural.ts";
import { zh } from "./zh/index.ts";

export type Language = "zh" | "en" | "ja";
export type LanguageSetting = "system" | Language;

export const LANGUAGES: readonly Language[] = ["zh", "en", "ja"];

/** 每种语言用它自己的文字写的名字：设置里的选项不翻译，看不懂当前界面的人也能找到自己的语言 */
export const LANGUAGE_NAMES: Record<Language, string> = { zh: "中文", en: "English", ja: "日本語" };

/** 每种语言在网页 lang 属性里的写法（读屏、断词、引号和按语言选字体都看它） */
export const LANGUAGE_TAGS: Record<Language, string> = { zh: "zh-CN", en: "en", ja: "ja" };

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof zh };
  }
}

ensurePluralRules();

export const i18n = i18next.createInstance();

void i18n.init({
  resources: { zh: { translation: zh }, en: { translation: en }, ja: { translation: ja } },
  lng: "zh",
  fallbackLng: "zh",
  supportedLngs: [...LANGUAGES],
  initAsync: false,
  interpolation: { escapeValue: false },
});

/** 一个语言标签（zh-Hans-CN、ja-JP、en-US……）对应的界面语言：中文、日文开头的各用各的，其他一律英文 */
export function languageOf(tag: string | null | undefined): Language {
  const match = tag ? /^(zh|ja)(?:[-_]|$)/i.exec(tag.trim()) : null;
  return match ? (match[1]!.toLowerCase() as Language) : "en";
}

/** 设置加上系统的语言列表（第一项是首选），得出实际用哪种语言 */
export function resolveLanguage(setting: LanguageSetting, systemTags: readonly string[]): Language {
  return setting === "system" ? languageOf(systemTags[0]) : setting;
}

/** 读存储里的设置；不认识的值退回跟随系统 */
export function parseLanguageSetting(raw: unknown): LanguageSetting {
  return isLanguage(raw) ? raw : "system";
}

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

export function currentLanguage(): Language {
  const resolved = i18n.resolvedLanguage;
  return isLanguage(resolved) ? resolved : "zh";
}

/** 切换界面语言（同步生效：资源都在包里）；已经是这种语言时什么都不做 */
export function applyLanguage(language: Language): void {
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

type Options = Record<string, unknown>;

/**
 * 按拼出来的 key 取翻译（错误码、枚举值这类运行时才知道的 key）：有这条就返回，没有返回 null。
 * 写死的 key 直接用 i18n.t，类型检查能发现拼错。
 */
export function lookup(key: string, options?: Options): string | null {
  if (!i18n.exists(key, options)) return null;
  return (i18n.t as unknown as (key: string, options?: Options) => string)(key, options);
}
