/**
 * 界面语言（docs/i18n.md）：设置是跟随系统、中文、English 或日本語，存在界面偏好里（state/prefs.ts）。
 * 跟随系统时看浏览器的语言列表（navigator.languages）；浏览器换了语言（languagechange 事件）跟着变。
 * 偏好从 localStorage 同步读出，入口在首屏渲染前就调用 applyLanguageSetting()，不会先闪一帧别的语言。
 */

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  applyLanguage,
  LANGUAGE_TAGS,
  languageOf,
  resolveLanguage,
  type Language,
  type LanguageSetting,
} from "@bettertavern/core/i18n/index";

function browserTags(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("languagechange", listener);
  return () => window.removeEventListener("languagechange", listener);
}

/** 浏览器首选的语言（设置里“跟随系统”下面注明） */
export function useSystemLanguage(): Language {
  return useSyncExternalStore(subscribe, () => languageOf(browserTags()[0]));
}

/** 切换界面语言，同时设好 <html lang>（读屏、断词、引号用它） */
export function applyLanguageSetting(setting: LanguageSetting): Language {
  const language = resolveLanguage(setting, browserTags());
  applyLanguage(language);
  document.documentElement.lang = LANGUAGE_TAGS[language];
  return language;
}

/** 按设置和浏览器语言切换界面语言；在绘制之前切 */
export function useLanguageSync(setting: LanguageSetting): void {
  const system = useSystemLanguage();
  useLayoutEffect(() => {
    applyLanguageSetting(setting);
  }, [setting, system]);
}
