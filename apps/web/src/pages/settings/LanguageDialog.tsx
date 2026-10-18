/**
 * 语言（同 App 的 LanguageSheet）：跟随系统、中文、English、日本語。点一下立刻生效，对话框不关，能直接看到效果。
 * 每种语言用它自己的文字写，不翻译；“跟随系统”下面注明浏览器现在是哪种语言。
 * 界面语言只决定界面文字和新开故事的提示词语言，不影响已有的存档（docs/i18n.md）。
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  LANGUAGES,
  type LanguageSetting,
} from "@bettertavern/core/i18n/index";

import { Button, cx } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useSystemLanguage } from "../../state/language.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import styles from "./settings.module.css";

export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { language, setLanguage } = usePrefs();
  const system = useSystemLanguage();
  const first = useRef<HTMLButtonElement>(null);
  const options: { value: LanguageSetting; label: string; note?: string }[] = [
    {
      value: "system",
      label: t("language.system"),
      note: t("language.systemNote", { language: LANGUAGE_NAMES[system] }),
    },
    ...LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
  ];
  return (
    <Dialog label={t("language.title")} onClose={onClose} initialFocus={first}>
      <h2 className={styles.dialogTitle}>{t("language.title")}</h2>
      <div className={styles.themes} role="radiogroup" aria-label={t("language.title")}>
        {options.map((option, i) => {
          const on = language === option.value;
          return (
            <button
              key={option.value}
              ref={i === 0 ? first : undefined}
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
      <Button label={t("common.done")} variant="secondary" size="lg" onClick={onClose} />
    </Dialog>
  );
}
