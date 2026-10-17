/**
 * “开始新的故事”的五步表单：名字（建议标签 + 随机）、这个角色是谁（一个多行输入框）、篇幅（行数图示）、
 * 文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口原来的字段，见 startForm.ts。
 * 宽屏的剧本详情两栏里（wide）：名字建议排在输入框右侧。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { Preferences } from "@bettertavern/core/api/types";
import {
  BOUNDARY_ITEMS,
  composeBoundaries,
  composeStyle,
  LENGTH_LABELS,
  NAME_MAX,
  randomName,
  STYLE_TAGS,
  suggestNames,
  SUMMARY_MAX,
  summaryParts,
} from "@bettertavern/core/scenario/startForm";

import { Checkbox, Chip, Field, Icon, useOverlay } from "../../components/ui.tsx";
import { font, radius, space, usePalette } from "../../theme/index.ts";

export type StartValues = {
  name: string;
  summary: string;
  length: Preferences["length"];
  style: string;
  boundaries: string;
};

/** 一步：浅灰圆角卡片，标题前一个白色圆形序号 */
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
    <View style={[styles.step, { backgroundColor: palette.bg2 }]}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNo, { backgroundColor: palette.card }]}>
          <Text style={{ fontFamily: font.monoMedium, fontSize: 12, color: palette.ink }}>{n}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.stepTitle, { color: palette.ink }]}>
          {title}
          {optional ? <Text style={[styles.optional, { color: palette.mut }]}> {optional}</Text> : null}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** 篇幅图示：几行圆头的横线，越长行数越多 */
const LENGTH_GLYPHS: Record<Preferences["length"], { d: string; width: number }> = {
  short: { d: "M2 4h32M2 11h20", width: 2.4 },
  medium: { d: "M2 4h32M2 11h32M2 18h22", width: 2.4 },
  long: { d: "M2 2h32M2 7h32M2 12h32M2 17h32M2 21h16", width: 2 },
};

/**
 * 表单本体：选择留在这里，变化时通过 onChange 报出拼好的字段和底部摘要的几段。
 */
export function StartForm({
  onChange,
  wide,
}: {
  onChange: (values: StartValues, summary: string[]) => void;
  /** 宽屏两栏：名字建议放到输入框右边 */
  wide?: boolean;
}) {
  const palette = usePalette();
  const overlay = useOverlay();
  const suggestions = useMemo(() => suggestNames(4), []);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [length, setLength] = useState<Preferences["length"]>("medium");
  const [styles_, setStyles] = useState<string[]>([]);
  const [customStyles, setCustomStyles] = useState<string[]>([]);
  const [bounds, setBounds] = useState<string[]>([]);
  const [customBounds, setCustomBounds] = useState<string[]>([]);

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
    onChangeRef.current(values, summaryParts({ name, length, styles: styles_, boundaries: bounds.length }));
  }, [name, summary, length, styles_, bounds]);

  const changeName = (text: string): void => setName(text);
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
      <Step n="1" title="你扮演谁">
        <View style={wide ? styles.nameRow : styles.nameColumn}>
          <Field
            label="主角的名字"
            hideLabel
            onGrey
            value={name}
            onChangeText={changeName}
            maxLength={NAME_MAX}
            placeholder="名字"
            style={wide ? { flex: 1 } : undefined}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="随机一个名字"
                onPress={() => changeName(randomName(name))}
                style={({ pressed }) => [
                  styles.dice,
                  {
                    backgroundColor: pressed ? palette.bg3 : palette.bg2,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}
              >
                <Icon name="dice" size={20} />
              </Pressable>
            }
          />
          <View style={wide ? styles.nameChips : styles.wrap}>
            {suggestions.map((n) => (
              <Chip key={n} label={n} onGrey selected={name.trim() === n} onPress={() => changeName(n)} />
            ))}
          </View>
        </View>
      </Step>

      <Step n="2" title="这个角色是谁" optional="可选">
        <Field
          label="这个角色是谁"
          hideLabel
          onGrey
          multiline
          counter
          value={summary}
          onChangeText={setSummary}
          maxLength={SUMMARY_MAX}
          placeholder="身份、来历、和卡里角色的关系"
        />
      </Step>

      <Step n="3" title="每段的长度">
        <View
          style={[styles.lengths, { backgroundColor: palette.bg3 }]}
          accessibilityRole="radiogroup"
          accessibilityLabel="每段的长度"
        >
          {(["short", "medium", "long"] as const).map((value) => {
            const on = length === value;
            const glyph = LENGTH_GLYPHS[value];
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={LENGTH_LABELS[value]}
                onPress={() => setLength(value)}
                style={[
                  styles.length,
                  on ? { backgroundColor: palette.card, boxShadow: palette.shadowLift } : null,
                ]}
              >
                <Svg width={36} height={22} viewBox="0 0 36 22">
                  <Path
                    d={glyph.d}
                    stroke={on ? palette.acc : palette.ink2}
                    strokeWidth={glyph.width}
                    strokeLinecap="round"
                  />
                </Svg>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: on ? "600" : "400",
                    color: on ? palette.ink : palette.ink2,
                  }}
                >
                  {LENGTH_LABELS[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Step>

      <Step n="4" title="文风" optional="可选 · 可多选">
        <View style={styles.wrap}>
          {[...STYLE_TAGS, ...customStyles].map((tag) => (
            <Chip
              key={tag}
              label={tag}
              check
              onGrey
              selected={styles_.includes(tag)}
              onPress={() => setStyles((list) => toggle(list, tag))}
            />
          ))}
          <Chip label="自定义" icon="plus" muted onGrey onPress={() => void addCustom("style")} />
        </View>
      </Step>

      <Step n="5" title="不想看到的内容" optional="可选">
        <View style={[styles.checks, { backgroundColor: palette.card }]}>
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
    marginHorizontal: space.list,
    marginBottom: space.s,
    paddingVertical: 20,
    paddingHorizontal: space.l,
    borderRadius: radius.group,
    gap: 14,
  },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNo: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepTitle: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  optional: { fontSize: 12.5, fontWeight: "400" },
  dice: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  /** 手机上：输入框和名字建议上下排，间距和步骤里其他内容一样 */
  nameColumn: { gap: 14 },
  nameChips: { flexDirection: "row", gap: 6 },
  lengths: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 26 },
  length: { flex: 1, alignItems: "center", gap: 10, paddingTop: 16, paddingBottom: 12, borderRadius: 22 },
  checks: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 10,
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: radius.card,
  },
  checkCell: { width: "47%" },
});
