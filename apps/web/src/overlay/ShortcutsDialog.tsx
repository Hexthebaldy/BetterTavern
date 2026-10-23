/**
 * 键盘快捷键（W12）：按 ? 或从阅读页的“更多”打开，宽 600。顶上是单键快捷键的开关（用读屏或语音输入的人可以关掉，
 * 存在浏览器里），下面分“阅读”“界面”两组，键帽都从 theme/layout.ts 的 SHORTCUTS 取。
 */

import { Fragment, useRef } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../components/controls.tsx";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { shell, SHORTCUTS, type Shortcut } from "../theme/layout.ts";
import { Dialog } from "./Dialog.tsx";
import styles from "./overlay.module.css";

/** 分两组：阅读（选、写、世界、回想）和界面（轮盘、这张表、关闭） */
const GROUPS: { title: "reading" | "app"; items: Shortcut[] }[] = [
  { title: "reading", items: SHORTCUTS.filter((s) => s.scope === "reading") },
  { title: "app", items: SHORTCUTS.filter((s) => s.scope === "app") },
];

function Keys({ keys, single }: { keys: string[]; single: boolean }) {
  // 单键的几个字母（A B C D）各自一个键帽；组合键之间加“+”
  return (
    <span className={styles.keys}>
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && !single ? <span className={styles.plus}>+</span> : null}
          <kbd className={styles.kbdLarge}>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { singleKeys, setSingleKeys } = usePrefs();
  const toggle = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  return (
    <Dialog
      label={t("shortcuts.title")}
      onClose={onClose}
      width={shell.shortcutsDialog}
      initialFocus={toggle}
    >
      <div className={styles.shortcutsHead}>
        <h2 className={styles.shortcutsTitle}>{t("shortcuts.title")}</h2>
        <IconButton icon="close" label={t("common.close")} diameter={36} iconSize={18} onClick={onClose} />
      </div>
      <label className={styles.singleRow}>
        <span className={styles.singleText}>
          <span className={styles.singleTitle}>{t("shortcuts.single")}</span>
          <span className={styles.singleNote}>{t("shortcuts.singleNote")}</span>
        </span>
        <input
          ref={toggle}
          type="checkbox"
          role="switch"
          className={styles.toggle}
          checked={singleKeys}
          onChange={(e) => setSingleKeys(e.target.checked)}
        />
      </label>
      {GROUPS.map((group) => (
        <section
          key={group.title}
          className={styles.shortcutGroup}
          aria-label={t(`shortcuts.${group.title}`)}
        >
          <div className={styles.groupTitle}>{t(`shortcuts.${group.title}`)}</div>
          <div className={styles.shortcutList}>
            {group.items.map((item) => (
              <div key={item.id} className={styles.shortcutRow}>
                <span>{t(`shortcuts.items.${item.id}`)}</span>
                <Keys keys={item.keys} single={item.single} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </Dialog>
  );
}
