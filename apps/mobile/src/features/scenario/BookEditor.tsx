/**
 * 编辑角色卡自带的世界书：条目默认收起（显示名称或内容开头、常驻 / 未启用 / 有问题的标记），点开一条编辑：
 * 名称、关键词（逗号或顿号分开）、内容，启用、常驻两个开关，上移、下移、删除。同一时间只展开一条。
 * 先后有意义：开局搭建世界时常驻条目优先，其次按这里的顺序。
 */

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { moveEntry, newEntry, type EntryDraft } from "@bettertavern/core/scenario/cardEdit";

import { Button, Field, Icon, IconButton, Pill, Toggle } from "../../components/ui.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";

function entryTitle(entry: EntryDraft): string {
  const name = entry.name.trim();
  if (name) return name;
  const first = entry.content.trim().split("\n")[0] ?? "";
  return first ? (first.length > 30 ? `${first.slice(0, 30)}…` : first) : "（空条目）";
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
  const palette = usePalette();
  return (
    <View style={styles.switchRow}>
      <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>{label}</Text>
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
  const palette = usePalette();
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
          <View key={entry.key} style={[styles.entry, { backgroundColor: palette.bg2 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`第 ${i + 1} 条：${entryTitle(entry)}`}
              onPress={() => setOpen(expanded ? null : entry.key)}
              style={styles.head}
            >
              <Text style={[styles.index, { color: palette.mut }]}>{i + 1}</Text>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: "500",
                  color: entry.enabled ? palette.ink : palette.mut,
                }}
              >
                {entryTitle(entry)}
              </Text>
              {broken ? <Pill tone="err" label="有问题" style={styles.pill} /> : null}
              {entry.constant ? <Pill tone="acc" label="常驻" style={styles.pill} /> : null}
              {!entry.enabled ? <Pill tone="card" label="未启用" style={styles.pill} /> : null}
              <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={palette.mut} />
            </Pressable>
            {expanded ? (
              <View style={styles.body}>
                <Field
                  label="名称"
                  optional
                  onGrey
                  value={entry.name}
                  onChangeText={(name) => update(i, { name })}
                  error={errors[0]}
                />
                <Field
                  label="关键词"
                  optional
                  onGrey
                  value={entry.keys}
                  onChangeText={(keys) => update(i, { keys })}
                  hint="用逗号或顿号分开"
                  error={errors[1]}
                />
                <Field
                  label="内容"
                  onGrey
                  multiline
                  boxHeight={140}
                  value={entry.content}
                  onChangeText={(content) => update(i, { content })}
                  error={errors[2]}
                />
                <Switch label="启用" value={entry.enabled} onChange={(enabled) => update(i, { enabled })} />
                <Switch
                  label="常驻（开局时优先使用）"
                  value={entry.constant}
                  onChange={(constant) => update(i, { constant })}
                />
                <View style={styles.actions}>
                  <IconButton
                    icon="chevronUp"
                    label="上移"
                    tone="card"
                    disabled={i === 0}
                    onPress={() => onChange(moveEntry(book, i, -1))}
                  />
                  <IconButton
                    icon="chevronDown"
                    label="下移"
                    tone="card"
                    disabled={i === book.length - 1}
                    onPress={() => onChange(moveEntry(book, i, 1))}
                  />
                  <View style={{ flex: 1 }} />
                  <Button
                    label="删除这条"
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
      <Button label="添加条目" icon="plus" variant="secondary" onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s },
  entry: { borderRadius: radius.card, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 52,
    paddingHorizontal: space.l,
  },
  /** Pill 默认贴着顶，在这一行里要居中 */
  pill: { alignSelf: "center" },
  index: { width: 24, fontSize: 13, fontVariant: ["tabular-nums"] },
  body: { gap: space.m, paddingHorizontal: space.l, paddingBottom: space.l },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 40 },
  actions: { flexDirection: "row", alignItems: "center", gap: space.s },
  delete: { height: 44, paddingHorizontal: space.l },
});
