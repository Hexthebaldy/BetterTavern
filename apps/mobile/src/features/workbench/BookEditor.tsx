/**
 * 编辑角色卡自带的世界书：条目默认收起（显示名称或内容开头、常驻 / 未启用 / 有问题的标记），点开一条编辑：
 * 名称、关键词（逗号或顿号分开）、内容，启用、常驻两个开关，上移、下移、删除。同一时间只展开一条。
 * 先后有意义：开局搭建世界时常驻条目优先，其次按这里的顺序。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { i18n } from "@bettertavern/core/i18n/index";
import { moveEntry, newEntry, type EntryDraft } from "@bettertavern/core/scenario/cardEdit";

import { Button, Field, Icon, IconButton, Pill, Toggle } from "../../components/ui.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../theme/index.ts";

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
  const c = useComic();
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);

  const update = (index: number, patch: Partial<EntryDraft>): void =>
    onChange(book.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const add = (): void => {
    const entry = newEntry();
    onChange([...book, entry]);
    setOpen(entry.key);
  };

  return (
    <View style={styles.list}>
      {book.map((entry, i) => {
        const expanded = open === entry.key;
        const where = `book.${i}`;
        const errors = [errorFor(`${where}.name`), errorFor(`${where}.keys`), errorFor(`${where}.content`)];
        const broken = errors.some(Boolean);
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
              {entry.constant ? <Pill tone="acc" label={t("cardEdit.constant")} style={styles.pill} /> : null}
              {!entry.enabled ? (
                <Pill tone="card" label={t("cardEdit.disabled")} style={styles.pill} />
              ) : null}
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
                  label={t("cardEdit.content")}
                  multiline
                  boxHeight={140}
                  value={entry.content}
                  onChangeText={(content) => update(i, { content })}
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
});
