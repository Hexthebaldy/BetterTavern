/**
 * 外观（W16，同 App 的 AppearanceSheet）：跟随系统、浅色、夜间，每项右边一小块配色预览。
 * 点一下立刻生效，对话框不关，能直接看到效果。
 */

import { useRef } from "react";

import type { Palette } from "@bettertavern/design/palettes";
import { SYSTEM_SETTING, THEME_ORDER, THEMES, type ThemeSetting } from "@bettertavern/design/themes";

import { Button, cx } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import styles from "./settings.module.css";

type Option = { value: ThemeSetting; label: string; note: string; previews: Palette[] };

const OPTIONS: Option[] = [
  { value: "system", ...SYSTEM_SETTING, previews: [THEMES.light.palette, THEMES.night.palette] },
  ...THEME_ORDER.map((id) => ({
    value: id,
    label: THEMES[id].label,
    note: THEMES[id].note,
    previews: [THEMES[id].palette],
  })),
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

export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = usePrefs();
  const first = useRef<HTMLButtonElement>(null);
  return (
    <Dialog label="外观" onClose={onClose} initialFocus={first}>
      <h2 className={styles.dialogTitle}>外观</h2>
      <div className={styles.themes} role="radiogroup" aria-label="外观">
        {OPTIONS.map((option, i) => {
          const on = theme === option.value;
          return (
            <button
              key={option.value}
              ref={i === 0 ? first : undefined}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(styles.themeOption, on && styles.themeOn)}
              onClick={() => setTheme(option.value)}
            >
              <span className={cx(styles.radio, on && styles.radioOn)} />
              <span className={styles.rowText}>
                <span className={styles.themeLabel}>{option.label}</span>
                <span className={styles.rowSub}>{option.note}</span>
              </span>
              <Swatch previews={option.previews} />
            </button>
          );
        })}
      </div>
      <Button label="完成" variant="secondary" size="lg" onClick={onClose} />
    </Dialog>
  );
}
