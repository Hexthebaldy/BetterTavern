/**
 * 编辑角色卡自带的世界书（同 App 的 src/features/scenario/BookEditor.tsx）：条目默认收起（显示名称或内容开头、
 * 常驻 / 未启用 / 有问题的标记），点开一条编辑：名称、关键词（逗号或顿号分开）、内容，启用、常驻两个开关，
 * 上移、下移、删除。同一时间只展开一条。先后有意义：开局搭建世界时常驻条目优先，其次按这里的顺序。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { i18n } from "@bettertavern/core/i18n/index";
import { moveEntry, newEntry, type EntryDraft } from "@bettertavern/core/scenario/cardEdit";

import { Button, cx, Field, IconButton, Pill, TextArea, Toggle } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./edit.module.css";

function entryTitle(entry: EntryDraft): string {
  const name = entry.name.trim();
  if (name) return name;
  const first = entry.content.trim().split("\n")[0] ?? "";
  return first ? (first.length > 30 ? `${first.slice(0, 30)}…` : first) : i18n.t("cardEdit.emptyEntry");
}

function Switch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.switchRow}>
      <span>{label}</span>
      <Toggle checked={value} onChange={onChange} />
    </label>
  );
}

export function BookEditor({
  book,
  onChange,
  errorFor,
}: {
  book: EntryDraft[];
  onChange: (book: EntryDraft[]) => void;
  /** 服务端或本地检查给出的错误，按 field（book.3.content 之类）取 */
  errorFor: (field: string) => string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<EntryDraft>): void =>
    onChange(book.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const add = (): void => {
    const entry = newEntry();
    onChange([...book, entry]);
    setOpen(entry.key);
  };

  return (
    <div className={styles.book}>
      {book.map((entry, i) => {
        const expanded = open === entry.key;
        const where = `book.${i}`;
        const errors = [errorFor(`${where}.name`), errorFor(`${where}.keys`), errorFor(`${where}.content`)];
        const bodyId = `entry-${entry.key}`;
        return (
          <div key={entry.key} className={cx(styles.entry, "surface-panel")}>
            <button
              type="button"
              className={styles.entryHead}
              aria-expanded={expanded}
              aria-controls={expanded ? bodyId : undefined}
              aria-label={t("cardEdit.entryLabel", { n: i + 1, title: entryTitle(entry) })}
              onClick={() => setOpen(expanded ? null : entry.key)}
            >
              <span className={styles.entryIndex}>{i + 1}</span>
              <span className={cx(styles.entryTitle, !entry.enabled && styles.entryOff)}>
                {entryTitle(entry)}
              </span>
              {errors.some(Boolean) ? (
                <Pill tone="err" label={t("cardEdit.broken")} className={styles.entryPill} />
              ) : null}
              {entry.constant ? (
                <Pill tone="acc" label={t("cardEdit.constant")} className={styles.entryPill} />
              ) : null}
              {!entry.enabled ? (
                <Pill tone="card" label={t("cardEdit.disabled")} className={styles.entryPill} />
              ) : null}
              <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} />
            </button>
            {expanded ? (
              <div id={bodyId} className={styles.entryBody}>
                <Field
                  label={t("cardEdit.entryName")}
                  optional
                  value={entry.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  error={errors[0]}
                />
                <Field
                  label={t("cardEdit.keywords")}
                  optional
                  value={entry.keys}
                  onChange={(e) => update(i, { keys: e.target.value })}
                  hint={t("cardEdit.hints.list")}
                  error={errors[1]}
                />
                <TextArea
                  label={t("cardEdit.content")}
                  height={140}
                  value={entry.content}
                  onChange={(e) => update(i, { content: e.target.value })}
                  error={errors[2]}
                />
                <Switch
                  label={t("cardEdit.enabled")}
                  value={entry.enabled}
                  onChange={(enabled) => update(i, { enabled })}
                />
                <Switch
                  label={t("cardEdit.constantLabel")}
                  value={entry.constant}
                  onChange={(constant) => update(i, { constant })}
                />
                <div className={styles.entryActions}>
                  <IconButton
                    icon="chevronUp"
                    label={t("cardEdit.moveUp")}
                    disabled={i === 0}
                    onClick={() => onChange(moveEntry(book, i, -1))}
                  />
                  <IconButton
                    icon="chevronDown"
                    label={t("cardEdit.moveDown")}
                    disabled={i === book.length - 1}
                    onClick={() => onChange(moveEntry(book, i, 1))}
                  />
                  <span className={styles.spacer} />
                  <Button
                    label={t("cardEdit.removeEntry")}
                    icon="trash"
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      onChange(book.filter((_, j) => j !== i));
                      setOpen(null);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      <Button label={t("cardEdit.addEntry")} icon="plus" variant="secondary" onClick={add} />
    </div>
  );
}
