/**
 * 编辑世界书条目（同网页端 pages/workbench/BookEditor.tsx）：工作台里卡自带的世界书和世界书详情页共用。
 * 条目默认收起（显示名称或内容开头、常驻 / 未启用 / 有问题 / 不会被带上的标记，和分组、概率这些小标），点开一条编辑：
 * 名称、关键词（逗号或顿号分开，/……/ 写的是正则）、次要关键词和它怎么算、内容，启用、常驻两个开关；
 * “更多设置”折叠起来：优先级、概率、分组和权重、连着带几回合、冷却、从第几回合起、两个递归开关、整词匹配。
 * 其余从 SillyTavern 带来的设置不给改，原样保留（docs/lorebook.md 第 9.2 节）。
 * 上移、下移、删除。同一时间只展开一条。filter 不为空时只列标题或关键词里有它的条目（编号不变）。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { LoreLogic, LoreRules } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import {
  joinList,
  moveEntry,
  newEntry,
  splitList,
  type EntryDraft,
} from "@bettertavern/core/scenario/cardEdit";
import {
  entryTags,
  hiddenRuleCount,
  matchesEntry,
  neverTriggers,
  parseWhole,
  rulesOf,
  withRules,
} from "@bettertavern/core/scenario/lorebook";

import { Button, Chip, Field, Icon, IconButton, Pill, Toggle } from "../../components/ui.tsx";
import { comicRadius, comicStroke, ctype, font, space, useComic } from "../../theme/index.ts";

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
  const c = useComic();
  return (
    <View style={styles.switchRow}>
      <Text style={{ flex: 1, fontSize: 15, color: c.ink }}>{label}</Text>
      <Toggle label={label} value={value} onChange={onChange} />
    </View>
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
    setText((current) =>
      parseWhole(current, min, max) === value ? current : value === null ? "" : String(value),
    );
  }, [value, min, max]);
  const parsed = parseWhole(text, min, max);
  return (
    <Field
      label={label}
      keyboardType="numbers-and-punctuation"
      value={text}
      placeholder={placeholder}
      hint={hint}
      error={parsed === undefined ? i18n.t("loreEdit.range", { min, max }) : null}
      onChangeText={(next) => {
        setText(next);
        const n = parseWhole(next, min, max);
        if (n !== undefined) onChange(n);
      }}
    />
  );
}

function MoreSettings({
  entry,
  onChange,
}: {
  entry: EntryDraft;
  onChange: (patch: Partial<EntryDraft>) => void;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const rules = rulesOf(entry);
  const set = (patch: Partial<LoreRules>): void => onChange({ rules: withRules(entry, patch).rules });
  const hidden = hiddenRuleCount(entry);
  return (
    <View style={[styles.more, { borderColor: c.line2 }]}>
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
        onChangeText={(text) => set({ groups: splitList(text) })}
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
      {hidden ? (
        <Text style={[styles.note, { color: c.mut }]}>{t("loreEdit.hidden", { count: hidden })}</Text>
      ) : null}
    </View>
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
  const c = useComic();
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);

  const update = (index: number, patch: Partial<EntryDraft>): void =>
    onChange(book.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const add = (): void => {
    const entry = newEntry();
    onChange([...book, entry]);
    setOpen(entry.key);
  };

  const shown = book.map((entry, i) => ({ entry, i })).filter(({ entry }) => matchesEntry(entry, filter));

  return (
    <View style={styles.list}>
      {filter.trim() && shown.length === 0 ? (
        <Text style={[styles.note, { color: c.mut }]}>
          {t("lorebook.noEntryMatch", { query: filter.trim() })}
        </Text>
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
        const broken = errors.some(Boolean);
        const never = entry.enabled && neverTriggers(entry);
        const tags = entryTags(entry);
        return (
          <View key={entry.key} style={[styles.entry, { backgroundColor: c.paper, borderColor: c.ink }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={t("cardEdit.entryLabel", { n: i + 1, title: entryTitle(entry) })}
              onPress={() => setOpen(expanded ? null : entry.key)}
              style={styles.head}
            >
              <Text style={[styles.index, { color: c.mut }]}>{i + 1}</Text>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: "700",
                  color: entry.enabled ? c.ink : c.mut,
                }}
              >
                {entryTitle(entry)}
              </Text>
              {broken ? <Pill tone="err" label={t("cardEdit.broken")} style={styles.pill} /> : null}
              {never && !broken ? (
                <Pill tone="warn" label={t("loreEdit.tags.never")} style={styles.pill} />
              ) : null}
              {entry.constant ? <Pill tone="acc" label={t("cardEdit.constant")} style={styles.pill} /> : null}
              {!entry.enabled ? (
                <Pill tone="card" label={t("cardEdit.disabled")} style={styles.pill} />
              ) : null}
              {tags[0] ? <Pill label={tags[0]} style={styles.pill} /> : null}
              <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={c.mut} />
            </Pressable>
            {expanded ? (
              <View style={styles.body}>
                <Field
                  label={t("cardEdit.entryName")}
                  optional
                  value={entry.name}
                  onChangeText={(name) => update(i, { name })}
                  error={errors[0]}
                />
                <Field
                  label={t("cardEdit.keywords")}
                  optional
                  value={entry.keys}
                  onChangeText={(keys) => update(i, { keys })}
                  hint={t("cardEdit.hints.list")}
                  error={errors[1]}
                />
                <Field
                  label={t("loreEdit.secondaryKeys")}
                  optional
                  value={entry.secondaryKeys}
                  onChangeText={(secondaryKeys) => update(i, { secondaryKeys })}
                  hint={t("loreEdit.secondaryHint")}
                  error={errors[3]}
                />
                {entry.secondaryKeys.trim() ? (
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t("loreEdit.logic")}
                    style={styles.logic}
                  >
                    <Text style={[ctype.label, styles.logicLabel, { color: c.ink }]}>{t("loreEdit.logic")}</Text>
                    <View style={styles.chips}>
                      {LOGICS.map((logic) => (
                        <Chip
                          key={logic}
                          small
                          label={t(`loreEdit.logics.${logic}`)}
                          selected={entry.logic === logic}
                          onPress={() => update(i, { logic })}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                <Field
                  label={t("cardEdit.content")}
                  multiline
                  boxHeight={140}
                  value={entry.content}
                  onChangeText={(content) => update(i, { content })}
                  error={errors[2]}
                />
                {never ? (
                  <Text style={[styles.note, { color: c.warn }]}>{t("loreEdit.neverTriggers")}</Text>
                ) : null}
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: more === entry.key }}
                  onPress={() => setMore(more === entry.key ? null : entry.key)}
                  style={styles.moreToggle}
                >
                  <Text style={{ fontSize: 14.5, fontWeight: "700", color: c.acc }}>
                    {t("loreEdit.more")}
                  </Text>
                  <Icon name={more === entry.key ? "chevronUp" : "chevronDown"} size={16} color={c.acc} />
                </Pressable>
                {more === entry.key ? (
                  <MoreSettings entry={entry} onChange={(patch) => update(i, patch)} />
                ) : null}
                <View style={styles.actions}>
                  <IconButton
                    icon="chevronUp"
                    label={t("cardEdit.moveUp")}
                    tone="card"
                    disabled={i === 0}
                    onPress={() => onChange(moveEntry(book, i, -1))}
                  />
                  <IconButton
                    icon="chevronDown"
                    label={t("cardEdit.moveDown")}
                    tone="card"
                    disabled={i === book.length - 1}
                    onPress={() => onChange(moveEntry(book, i, 1))}
                  />
                  <View style={{ flex: 1 }} />
                  <Button
                    label={t("cardEdit.removeEntry")}
                    icon="trash"
                    variant="danger"
                    onPress={() => {
                      onChange(book.filter((_, j) => j !== i));
                      setOpen(null);
                    }}
                    style={styles.delete}
                  />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <Button label={t("cardEdit.addEntry")} icon="plus" variant="secondary" onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s },
  entry: { borderRadius: comicRadius.frame, borderWidth: comicStroke.frame, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 52,
    paddingHorizontal: space.l,
  },
  /** Pill 默认贴着顶，在这一行里要居中 */
  pill: { alignSelf: "center" },
  index: { width: 24, fontFamily: font.monoMedium, fontSize: 13 },
  body: { gap: space.m, paddingHorizontal: space.l, paddingBottom: space.l },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 40 },
  actions: { flexDirection: "row", alignItems: "center", gap: space.s },
  delete: { paddingHorizontal: space.l },
  logic: { gap: space.s },
  logicLabel: { paddingLeft: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  note: { fontSize: 13, lineHeight: 20 },
  moreToggle: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 36 },
  more: {
    gap: space.m,
    padding: space.m,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
});
