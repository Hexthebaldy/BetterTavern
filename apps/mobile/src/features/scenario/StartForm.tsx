/**
 * “开始新的故事”的五步表单：名字（建议标签 + 随机）、身份（图块 + 可改的底稿）、篇幅（行数图示）、
 * 文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口原来的字段，见 startForm.ts。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { Preferences } from "../../api/types.ts";
import { Checkbox, Chip, Field, Icon, useOverlay } from "../../components/ui.tsx";
import { font, space, usePalette } from "../../theme/index.ts";
import {
  BOUNDARY_ITEMS,
  composeBoundaries,
  composeStyle,
  IDENTITIES,
  LENGTH_LABELS,
  NAME_MAX,
  randomName,
  STYLE_TAGS,
  suggestNames,
  SUMMARY_MAX,
  summaryLine,
} from "./startForm.ts";

export type StartValues = {
  name: string;
  summary: string;
  length: Preferences["length"];
  style: string;
  boundaries: string;
};

function Step({
  n,
  title,
  optional,
  children,
}: {
  n: string;
  title: string;
  optional?: string;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.step, { borderBottomColor: palette.line }]}>
      <Text style={[styles.stepNo, { color: palette.mut }]}>{n}</Text>
      <View style={{ flex: 1, gap: 14 }}>
        <Text accessibilityRole="header" style={[styles.stepTitle, { color: palette.ink }]}>
          {title}
          {optional ? <Text style={[styles.optional, { color: palette.mut }]}> {optional}</Text> : null}
        </Text>
        {children}
      </View>
    </View>
  );
}

const LENGTH_GLYPHS: Record<Preferences["length"], string> = {
  short: "M0 4h40M0 12h26",
  medium: "M0 4h40M0 12h40M0 20h30",
  long: "M0 2h40M0 8h40M0 14h40M0 20h40M0 26h22",
};

/**
 * 表单本体：选择留在这里，变化时通过 onChange 报出拼好的字段和底部的摘要行。
 */
export function StartForm({
  cardName,
  onChange,
}: {
  cardName: string;
  onChange: (values: StartValues, summaryText: string) => void;
}) {
  const palette = usePalette();
  const overlay = useOverlay();
  const suggestions = useMemo(() => suggestNames(4), []);
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [length, setLength] = useState<Preferences["length"]>("medium");
  const [styles_, setStyles] = useState<string[]>([]);
  const [customStyles, setCustomStyles] = useState<string[]>([]);
  const [bounds, setBounds] = useState<string[]>([]);
  const [customBounds, setCustomBounds] = useState<string[]>([]);
  const summaryInput = useRef<TextInput>(null);

  // 选择变了就把拼好的值报给父组件
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const values: StartValues = {
      name: name.trim(),
      summary: summary.trim(),
      length,
      style: composeStyle(styles_),
      boundaries: composeBoundaries(bounds),
    };
    const identityLabel = IDENTITIES.find((i) => i.key === identity)?.label ?? null;
    onChangeRef.current(
      values,
      summaryLine({ name, identity: identityLabel, length, styles: styles_, boundaries: bounds.length }),
    );
  }, [name, identity, summary, length, styles_, bounds]);

  const changeName = (text: string): void => setName(text);
  const pickIdentity = (key: string | null): void => {
    setIdentity(key);
    const draft = key ? (IDENTITIES.find((i) => i.key === key)?.draft(cardName) ?? "") : "";
    if (key) {
      setSummary(draft);
    } else {
      summaryInput.current?.focus();
    }
  };
  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const addCustom = async (kind: "style" | "bound"): Promise<void> => {
    const text = await overlay.prompt({
      title: kind === "style" ? "自定义文风" : "其他不想看到的内容",
      label: kind === "style" ? "文风" : "不想看到的内容",
      placeholder: kind === "style" ? "例如：多写环境" : "例如：校园霸凌",
      maxLength: 30,
      confirmLabel: "添加",
    });
    if (!text) return;
    if (kind === "style") {
      setCustomStyles((list) => (list.includes(text) ? list : [...list, text]));
      setStyles((list) => (list.includes(text) ? list : [...list, text]));
    } else {
      setCustomBounds((list) => (list.includes(text) ? list : [...list, text]));
      setBounds((list) => (list.includes(text) ? list : [...list, text]));
    }
  };

  return (
    <View>
      <Step n="01" title="你扮演谁">
        <View style={styles.nameRow}>
          <Field
            label="主角的名字"
            hideLabel
            value={name}
            onChangeText={changeName}
            maxLength={NAME_MAX}
            placeholder="名字"
            style={{ flex: 1 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="随机一个名字"
            onPress={() => changeName(randomName(name))}
            style={({ pressed }) => [
              styles.dice,
              { borderColor: palette.line2, backgroundColor: pressed ? palette.bg2 : palette.bg },
            ]}
          >
            <Icon name="dice" />
          </Pressable>
        </View>
        <View style={styles.wrap}>
          {suggestions.map((n) => (
            <Chip key={n} label={n} selected={name.trim() === n} onPress={() => changeName(n)} />
          ))}
        </View>
      </Step>

      <Step n="02" title="这个角色是谁" optional="可选">
        <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel="身份">
          {[
            ...IDENTITIES.map((i) => ({ key: i.key, label: i.label, icon: i.icon })),
            { key: "", label: "自己写", icon: "write" as const },
          ].map((i) => {
            const on = i.key !== "" && identity === i.key;
            return (
              <Pressable
                key={i.key || "custom"}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={i.label}
                onPress={() => pickIdentity(i.key || null)}
                style={[
                  styles.tile,
                  on
                    ? { borderWidth: 2, borderColor: palette.ink }
                    : { borderWidth: 1, borderColor: palette.line2 },
                ]}
              >
                <Icon name={i.icon} color={i.key ? palette.ink : palette.mut} />
                <View style={styles.tileLabel}>
                  <Text style={{ flex: 1, fontSize: 14, color: i.key ? palette.ink : palette.mut }}>
                    {i.label}
                  </Text>
                  {on ? <Icon name="check" size={18} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Field
          ref={summaryInput}
          label="补充描述"
          hideLabel
          multiline
          counter
          value={summary}
          onChangeText={setSummary}
          maxLength={SUMMARY_MAX}
          placeholder="身份、来历、和卡里角色的关系"
          hint="选一个身份会自动填一句底稿，可以接着改。"
        />
      </Step>

      <Step n="03" title="每段的长度">
        <View style={styles.lengths} accessibilityRole="radiogroup" accessibilityLabel="每段的长度">
          {(["short", "medium", "long"] as const).map((value, i) => {
            const on = length === value;
            const fg = on ? palette.bg : palette.ink;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={LENGTH_LABELS[value]}
                onPress={() => setLength(value)}
                style={[
                  styles.length,
                  on ? { backgroundColor: palette.ink } : { borderWidth: 1, borderColor: palette.line2 },
                  i > 0 && !on ? { marginLeft: -1 } : null,
                ]}
              >
                <Svg width={40} height={28} viewBox="0 0 40 28">
                  <Path d={LENGTH_GLYPHS[value]} stroke={fg} strokeWidth={2} />
                </Svg>
                <Text style={{ fontSize: 14, color: fg }}>{LENGTH_LABELS[value]}</Text>
              </Pressable>
            );
          })}
        </View>
      </Step>

      <Step n="04" title="文风" optional="可选 · 可多选">
        <View style={styles.wrap}>
          {[...STYLE_TAGS, ...customStyles].map((tag) => (
            <Chip
              key={tag}
              label={tag}
              check
              selected={styles_.includes(tag)}
              onPress={() => setStyles((list) => toggle(list, tag))}
            />
          ))}
          <Chip label="自定义" icon="plus" muted onPress={() => void addCustom("style")} />
        </View>
      </Step>

      <Step n="05" title="不想看到的内容" optional="可选">
        <View style={styles.checks}>
          {[...BOUNDARY_ITEMS, ...customBounds].map((item) => (
            <View key={item} style={styles.checkCell}>
              <Checkbox
                label={item}
                checked={bounds.includes(item)}
                onToggle={() => setBounds((list) => toggle(list, item))}
              />
            </View>
          ))}
          <View style={styles.checkCell}>
            <Checkbox label="其他…" checked={false} plus onToggle={() => void addCustom("bound")} />
          </View>
        </View>
      </Step>
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    flexDirection: "row",
    gap: space.m,
    paddingVertical: space.read,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  stepNo: { width: 40, fontFamily: font.mono, fontSize: 12, lineHeight: 24, letterSpacing: 0.5 },
  stepTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  optional: { fontFamily: font.mono, fontSize: 12, fontWeight: "400" },
  nameRow: { flexDirection: "row", gap: space.s },
  dice: { width: 52, height: 52, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  tile: { width: "48.5%", minHeight: 96, padding: 14, justifyContent: "space-between", gap: 10 },
  tileLabel: { flexDirection: "row", alignItems: "center" },
  lengths: { flexDirection: "row" },
  length: { flex: 1, minHeight: 104, padding: 14, justifyContent: "space-between" },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: space.m },
  checkCell: { width: "47%" },
});
