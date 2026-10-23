/**
 * 设置页里直接摆出来的两组选项（不再弹对话框），点一下立刻生效：
 * - 外观（同 App 的 AppearanceSheet）：跟随系统、浅色、夜间，每项右边一小块配色预览；
 * - 语言（同 App 的 LanguageSheet）：跟随系统、中文、English、日本語。每种语言用它自己的文字写，不翻译；
 *   “跟随系统”下面注明浏览器现在是哪种语言。界面语言只决定界面文字和新开故事的提示词语言（docs/i18n.md）。
 */

import { useTranslation } from "react-i18next";

import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  LANGUAGES,
  type LanguageSetting,
} from "@bettertavern/core/i18n/index";
import type { Palette } from "@bettertavern/design/palettes";
import { THEME_ORDER, THEMES, type ThemeSetting } from "@bettertavern/design/themes";

import { cx } from "../../components/controls.tsx";
import { useSystemLanguage } from "../../state/language.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import styles from "./settings.module.css";

type ThemeOption = { value: ThemeSetting; previews: Palette[] };

/** 名字和说明在 i18n 资源里：appearance.<id>、appearance.<id>Note */
const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", previews: [THEMES.light.palette, THEMES.night.palette] },
  ...THEME_ORDER.map((id) => ({ value: id, previews: [THEMES[id].palette] })),
];

/** 配色预览：页面底色上一条灰卡，下面一个墨色点和一个强调色点 */
function Swatch({ previews }: { previews: Palette[] }) {
  return (
    <span className={styles.swatch} aria-hidden="true">
      {previews.map((p, i) => (
        <span key={i} className={styles.swatchPart} style={{ background: p.bg }}>
          <span className={styles.swatchBar} style={{ background: p.bg2 }} />
          <span className={styles.swatchDots}>
            <span style={{ background: p.ink }} />
            <span style={{ background: p.acc }} />
          </span>
        </span>
      ))}
    </span>
  );
}

export function ThemeOptions({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, setTheme } = usePrefs();
  return (
    <div className={cx(styles.themes, className)} role="radiogroup" aria-label={t("appearance.title")}>
      {THEME_OPTIONS.map((option) => {
        const on = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={cx(styles.themeOption, on && styles.themeOn)}
            onClick={() => setTheme(option.value)}
          >
            <span className={cx(styles.radio, on && styles.radioOn)} />
            <span className={styles.rowText}>
              <span className={styles.themeLabel}>{t(`appearance.${option.value}`)}</span>
              <span className={styles.rowSub}>{t(`appearance.${option.value}Note`)}</span>
            </span>
            <Swatch previews={option.previews} />
          </button>
        );
      })}
    </div>
  );
}

export function LanguageOptions({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = usePrefs();
  const system = useSystemLanguage();
  const options: { value: LanguageSetting; label: string; note?: string }[] = [
    {
      value: "system",
      label: t("language.system"),
      note: t("language.systemNote", { language: LANGUAGE_NAMES[system] }),
    },
    ...LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
  ];
  return (
    <div className={cx(styles.themes, className)} role="radiogroup" aria-label={t("language.title")}>
      {options.map((option) => {
        const on = language === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            lang={option.value === "system" ? undefined : LANGUAGE_TAGS[option.value]}
            className={cx(styles.themeOption, on && styles.themeOn)}
            onClick={() => setLanguage(option.value)}
          >
            <span className={cx(styles.radio, on && styles.radioOn)} />
            <span className={styles.rowText}>
              <span className={styles.themeLabel}>{option.label}</span>
              {option.note ? <span className={styles.rowSub}>{option.note}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
