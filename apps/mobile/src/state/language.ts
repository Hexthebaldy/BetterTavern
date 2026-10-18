/**
 * 界面语言（docs/i18n.md）：设置是跟随系统、中文、English 或日本語，存在界面偏好里（PrefsProvider）。
 * 这个模块一加载就按系统语言初始化，偏好读出来之前的那几帧也是对的语言（启动画面挡着，用户看不到）；
 * 之后 useLanguageSync() 跟着设置和系统语言切换。
 */

import { getLocales, useLocales } from "expo-localization";
import { useLayoutEffect } from "react";

import {
  applyLanguage,
  languageOf,
  resolveLanguage,
  type Language,
  type LanguageSetting,
} from "@bettertavern/core/i18n/index";

applyLanguage(languageOf(getLocales()[0]?.languageTag));

/** 系统现在的语言（设置面板里“跟随系统”下面注明） */
export function useSystemLanguage(): Language {
  return languageOf(useLocales()[0]?.languageTag);
}

/** 按设置和系统语言切换界面语言；在绘制之前切，界面不会先闪一帧旧语言 */
export function useLanguageSync(setting: LanguageSetting): Language {
  const tags = useLocales().map((locale) => locale.languageTag);
  const language = resolveLanguage(setting, tags);
  useLayoutEffect(() => applyLanguage(language), [language]);
  return language;
}
