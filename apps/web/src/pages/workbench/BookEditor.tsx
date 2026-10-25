/**
 * 编辑世界书条目（同 App 的 src/features/workbench/BookEditor.tsx）：工作台里卡自带的世界书和世界书详情页共用。
 * 条目默认收起（显示名称或内容开头、常驻 / 未启用 / 有问题 / 分组、概率这些小标），点开一条编辑：
 * 名称、关键词（逗号或顿号分开，/……/ 写的是正则）、次要关键词和它怎么算、内容，启用、常驻两个开关；
 * “更多设置”折叠起来：优先级、概率、分组和权重、连着带几回合、冷却、从第几回合起、两个递归开关、整词匹配。
 * 其余从 SillyTavern 带来的设置不给改，原样保留（docs/lorebook.md 第 9.1 节）。
 * 上移、下移、删除。同一时间只展开一条。filter 不为空时只列标题或关键词里有它的条目（编号不变）。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LoreLogic, LoreRules } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { joinList, moveEntry, newEntry, splitList, type EntryDraft } from "@bettertavern/core/scenario/cardEdit";
import {
  entryTags,
  hiddenRuleCount,
  matchesEntry,
  neverTriggers,
  parseWhole,
  rulesOf,
  withRules,
} from "@bettertavern/core/scenario/lorebook";

import { Button, Chip, cx, Field, IconButton, Pill, TextArea, Toggle } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./edit.module.css";

const LOGICS: LoreLogic[] = ["any", "all", "not_any", "not_all"];

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

/** 整数输入：先按文字存着（允许暂时空着、正在输入负号），合法时才交出去 */
function WholeField({
  label,
  value,
  min,
  max,
  hint,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  hint?: string;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((current) => (parseWhole(current, min, max) === value ? current : value === null ? "" : String(value)));
  }, [value, min, max]);
  const parsed = parseWhole(text, min, max);
  return (
    <Field
      label={label}
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      hint={hint}
      error={parsed === undefined ? i18n.t("loreEdit.range", { min, max }) : null}
      onChange={(e) => {
        setText(e.target.value);
        const next = parseWhole(e.target.value, min, max);
        if (next !== undefined) onChange(next);
      }}
    />
  );
}

function MoreSettings({ entry, onChange }: { entry: EntryDraft; onChange: (patch: Partial<EntryDraft>) => void }) {
  const { t } = useTranslation();
  const rules = rulesOf(entry);
  const set = (patch: Partial<LoreRules>): void => onChange({ rules: withRules(entry, patch).rules });
  const hidden = hiddenRuleCount(entry);
  return (
    <div className={styles.more}>
      <WholeField
        label={t("loreEdit.priority")}
        value={entry.priority}
        min={-1_000_000}
        max={1_000_000}
        placeholder="100"
        hint={t("loreEdit.priorityHint")}
        onChange={(priority) => onChange({ priority })}
      />
      <WholeField
        label={t("loreEdit.probability")}
        value={rules.probability}
        min={0}
        max={100}
        onChange={(n) => set({ probability: n ?? 100 })}
      />
      <Field
        label={t("loreEdit.groups")}
        optional
        value={joinList(rules.groups)}
        hint={t("loreEdit.groupsHint")}
        onChange={(e) => set({ groups: splitList(e.target.value) })}
      />
      {rules.groups.length ? (
        <WholeField
          label={t("loreEdit.groupWeight")}
          value={rules.group_weight}
          min={0}
          max={1_000_000}
          hint={t("loreEdit.groupWeightHint")}
          onChange={(n) => set({ group_weight: n ?? 100 })}
        />
      ) : null}
      <div className={styles.moreRow}>
        <WholeField
          label={t("loreEdit.sticky")}
          value={rules.sticky}
          min={0}
          max={1000}
          hint={t("loreEdit.stickyHint")}
          onChange={(n) => set({ sticky: n ?? 0 })}
        />
        <WholeField
          label={t("loreEdit.cooldown")}
          value={rules.cooldown}
          min={0}
          max={1000}
          hint={t("loreEdit.cooldownHint")}
          onChange={(n) => set({ cooldown: n ?? 0 })}
        />
        <WholeField
          label={t("loreEdit.delay")}
          value={rules.delay}
          min={0}
          max={1000}
          onChange={(n) => set({ delay: n ?? 0 })}
        />
      </div>
      <Switch
        label={t("loreEdit.excludeRecursion")}
        value={rules.exclude_recursion}
        onChange={(v) => set({ exclude_recursion: v })}
      />
      <Switch
        label={t("loreEdit.preventRecursion")}
        value={rules.prevent_recursion}
        onChange={(v) => set({ prevent_recursion: v })}
      />
      <Switch
        label={t("loreEdit.wholeWords")}
        value={rules.whole_words ?? true}
        onChange={(v) => set({ whole_words: v ? null : false })}
      />
      {hidden ? <p className={styles.moreNote}>{t("loreEdit.hidden", { count: hidden })}</p> : null}
    </div>
  );
}

export function BookEditor({
  book,
  onChange,
  errorFor,
  filter = "",
}: {
  book: EntryDraft[];
  onChange: (book: EntryDraft[]) => void;
  /** 服务端或本地检查给出的错误，按 field（book.3.content 之类）取 */
  errorFor: (field: string) => string | null;
  /** 搜索：只列标题或关键词里有它的条目 */
  filter?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<EntryDraft>): void =>
    onChange(book.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const add = (): void => {
    const entry = newEntry();
    onChange([...book, entry]);
    setOpen(entry.key);
  };

  const shown = book.map((entry, i) => ({ entry, i })).filter(({ entry }) => matchesEntry(entry, filter));

  return (
    <div className={styles.book}>
      {filter.trim() && shown.length === 0 ? (
        <p className={styles.note}>{t("lorebook.noEntryMatch", { query: filter.trim() })}</p>
      ) : null}
      {shown.map(({ entry, i }) => {
        const expanded = open === entry.key;
        const where = `book.${i}`;
        const errors = [
          errorFor(`${where}.name`),
          errorFor(`${where}.keys`),
          errorFor(`${where}.content`),
          errorFor(`${where}.secondary_keys`),
        ];
        const never = entry.enabled && neverTriggers(entry);
        const bodyId = `entry-${entry.key}`;
        const tags = entryTags(entry);
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
              <span className={cx(styles.entryTitle, !entry.enabled && styles.entryOff)}>{entryTitle(entry)}</span>
              {errors.some(Boolean) ? <Pill tone="err" label={t("cardEdit.broken")} className={styles.entryPill} /> : null}
              {never && !errors.some(Boolean) ? (
                <Pill tone="warn" label={t("loreEdit.tags.never")} className={styles.entryPill} />
              ) : null}
              {entry.constant ? <Pill tone="acc" label={t("cardEdit.constant")} className={styles.entryPill} /> : null}
              {!entry.enabled ? <Pill tone="card" label={t("cardEdit.disabled")} className={styles.entryPill} /> : null}
              {tags.slice(0, 2).map((tag) => (
                <Pill key={tag} tone="grey" label={tag} className={cx(styles.entryPill, styles.entryTag)} />
              ))}
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
                <Field
                  label={t("loreEdit.secondaryKeys")}
                  optional
                  value={entry.secondaryKeys}
                  onChange={(e) => update(i, { secondaryKeys: e.target.value })}
                  hint={t("loreEdit.secondaryHint")}
                  error={errors[3]}
                />
                {entry.secondaryKeys.trim() ? (
                  <div className={styles.logic} role="radiogroup" aria-label={t("loreEdit.logic")}>
                    <span className={styles.logicLabel}>{t("loreEdit.logic")}</span>
                    <div className={styles.logicChips}>
                      {LOGICS.map((logic) => (
                        <Chip
                          key={logic}
                          label={t(`loreEdit.logics.${logic}`)}
                          selected={entry.logic === logic}
                          onClick={() => update(i, { logic })}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                <TextArea
                  label={t("cardEdit.content")}
                  height={140}
                  value={entry.content}
                  onChange={(e) => update(i, { content: e.target.value })}
                  error={errors[2]}
                />
                {never ? <p className={styles.warnLine}>{t("loreEdit.neverTriggers")}</p> : null}
                <Switch label={t("cardEdit.enabled")} value={entry.enabled} onChange={(enabled) => update(i, { enabled })} />
                <Switch
                  label={t("cardEdit.constantLabel")}
                  value={entry.constant}
                  onChange={(constant) => update(i, { constant })}
                />
                <button
                  type="button"
                  className={styles.moreToggle}
                  aria-expanded={more === entry.key}
                  onClick={() => setMore(more === entry.key ? null : entry.key)}
                >
                  {t("loreEdit.more")}
                  <Icon name={more === entry.key ? "chevronUp" : "chevronDown"} size={16} />
                </button>
                {more === entry.key ? <MoreSettings entry={entry} onChange={(patch) => update(i, patch)} /> : null}
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
