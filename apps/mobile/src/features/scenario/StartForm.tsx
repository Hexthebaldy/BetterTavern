/**
 * “开始新的故事”的五步表单：名字（建议标签 + 随机）、这个角色是谁（一个多行输入框）、篇幅（行数图示）、
 * 文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口原来的字段，见 startForm.ts。
 * 宽屏的剧本详情两栏里（wide）：名字建议排在输入框右侧。
 * initial：按剧本设置预填（默认主角、偏好）；不在内置标签里的文风、不想看到的内容当作自定义的项。
 * 也用在新建、编辑剧本（app/scenario/form.tsx）里填剧本的默认设置。
 *
 * 漫画风（docs/design/comic/mobile/png/16–17）：每一步一个白底墨线的格子，步骤号是墨底方块白字；
 * 篇幅是三格的切换（选中墨底），不想看到的内容是两列复选框。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { Preferences } from "@bettertavern/core/api/types";
import {
  boundaryItems,
  composeBoundaries,
  composeStyle,
  lengthLabel,
  NAME_MAX,
  randomName,
  splitJoined,
  styleTags,
  suggestNames,
  SUMMARY_MAX,
  summaryParts,
} from "@bettertavern/core/scenario/startForm";

import { Checkbox, Chip, Field, Icon, useOverlay } from "../../components/ui.tsx";
import { comicRadius, comicStroke, ctype, font, space, useComic } from "../../theme/index.ts";

export type StartValues = {
  name: string;
  summary: string;
  length: Preferences["length"];
  style: string;
  boundaries: string;
};

/** 一步：白底墨线的格子，标题前一个墨底方块序号 */
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
  const c = useComic();
  return (
    <View style={[styles.step, { borderColor: c.ink, backgroundColor: c.paper }]}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNo, { backgroundColor: c.ink }]}>
          <Text style={{ fontFamily: font.monoMedium, fontSize: 13, fontWeight: "700", color: c.paper }}>{n}</Text>
        </View>
        <Text accessibilityRole="header" style={[ctype.frameTitle, styles.stepTitle, { color: c.ink }]}>
          {title}
          {optional ? <Text style={[styles.optional, { color: c.mut }]}>  {optional}</Text> : null}
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
  initial,
}: {
  onChange: (values: StartValues, summary: string[]) => void;
  /** 宽屏两栏：名字建议放到输入框右边 */
  wide?: boolean;
  initial?: StartValues;
}) {
  const c = useComic();
  const overlay = useOverlay();
  const { t, i18n } = useTranslation();
  // 名字建议、内置的文风和边界随界面语言
  const suggestions = useMemo(() => suggestNames(4), [i18n.language]);
  const tags = useMemo(() => styleTags(), [i18n.language]);
  const avoidItems = useMemo(() => boundaryItems(), [i18n.language]);
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [length, setLength] = useState<Preferences["length"]>(initial?.length ?? "medium");
  const [styles_, setStyles] = useState<string[]>(() => splitJoined(initial?.style ?? ""));
  const [customStyles, setCustomStyles] = useState<string[]>(() =>
    splitJoined(initial?.style ?? "").filter((tag) => !tags.includes(tag)),
  );
  const [bounds, setBounds] = useState<string[]>(() => splitJoined(initial?.boundaries ?? ""));
  const [customBounds, setCustomBounds] = useState<string[]>(() =>
    splitJoined(initial?.boundaries ?? "").filter((item) => !avoidItems.includes(item)),
  );

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
    // 换了界面语言，底部摘要（“还没起名”“适中”）也要换
  }, [name, summary, length, styles_, bounds, i18n.language]);

  const changeName = (text: string): void => setName(text);
  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const addCustom = async (kind: "style" | "bound"): Promise<void> => {
    const text = await overlay.prompt({
      title: kind === "style" ? t("start.customStyleTitle") : t("start.customAvoidTitle"),
      label: kind === "style" ? t("start.customStyleLabel") : t("start.customAvoidLabel"),
      placeholder: kind === "style" ? t("start.customStylePlaceholder") : t("start.customAvoidPlaceholder"),
      maxLength: 30,
      confirmLabel: t("common.add"),
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
      <Step n="1" title={t("start.stepWho")}>
        <View style={wide ? styles.nameRow : styles.nameColumn}>
          <Field
            label={t("start.nameLabel")}
            hideLabel
            value={name}
            onChangeText={changeName}
            maxLength={NAME_MAX}
            placeholder={t("start.namePlaceholder")}
            style={wide ? { flex: 1 } : undefined}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("start.randomName")}
                onPress={() => changeName(randomName(name))}
                style={({ pressed }) => [styles.dice, { backgroundColor: pressed ? c.grey : "transparent" }]}
              >
                <Icon name="dice" size={22} color={c.ink} />
              </Pressable>
            }
          />
          <View style={wide ? styles.nameChips : styles.wrap}>
            {suggestions.map((n) => (
              <Chip key={n} label={n} selected={name.trim() === n} onPress={() => changeName(n)} />
            ))}
          </View>
        </View>
      </Step>

      <Step n="2" title={t("start.stepIdentity")} optional={t("common.optional")}>
        <Field
          label={t("start.stepIdentity")}
          hideLabel
          multiline
          counter
          value={summary}
          onChangeText={setSummary}
          maxLength={SUMMARY_MAX}
          placeholder={t("start.identityPlaceholder")}
        />
      </Step>

      <Step n="3" title={t("start.stepLength")}>
        <View
          style={[styles.lengths, { borderColor: c.ink, backgroundColor: c.paper }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("start.stepLength")}
        >
          {(["short", "medium", "long"] as const).map((value, i) => {
            const on = length === value;
            const glyph = LENGTH_GLYPHS[value];
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={lengthLabel(value)}
                onPress={() => setLength(value)}
                style={({ pressed }) => [
                  styles.length,
                  i > 0 ? { borderLeftWidth: comicStroke.control, borderLeftColor: c.ink } : null,
                  { backgroundColor: on ? c.ink : pressed ? c.grey : "transparent" },
                ]}
              >
                <Svg width={28} height={18} viewBox="0 0 36 22">
                  <Path
                    d={glyph.d}
                    stroke={on ? c.paper : c.ink}
                    strokeWidth={glyph.width + 0.6}
                    strokeLinecap="round"
                  />
                </Svg>
                <Text style={{ fontSize: 15, fontWeight: "700", color: on ? c.paper : c.ink }}>
                  {lengthLabel(value)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Step>

      <Step n="4" title={t("start.stepStyle")} optional={t("start.optionalMulti")}>
        <View style={styles.wrap}>
          {[...tags, ...customStyles].map((tag) => (
            <Chip
              key={tag}
              label={tag}
              check
              selected={styles_.includes(tag)}
              onPress={() => setStyles((list) => toggle(list, tag))}
            />
          ))}
          <Chip
            label={t("start.customStyle")}
            icon="plus"
            muted
            onPress={() => void addCustom("style")}
          />
        </View>
      </Step>

      <Step n="5" title={t("start.stepAvoid")} optional={t("common.optional")}>
        <View style={styles.checks}>
          {[...avoidItems, ...customBounds].map((item) => (
            <View key={item} style={styles.checkCell}>
              <Checkbox
                label={item}
                checked={bounds.includes(item)}
                onToggle={() => setBounds((list) => toggle(list, item))}
              />
            </View>
          ))}
          <View style={styles.checkCell}>
            <Checkbox
              label={t("start.other")}
              checked={false}
              plus
              onToggle={() => void addCustom("bound")}
            />
          </View>
        </View>
      </Step>
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    marginHorizontal: 20,
    marginBottom: space.m,
    paddingVertical: space.l,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: 14,
  },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNo: { width: 26, height: 26, borderRadius: comicRadius.tag, alignItems: "center", justifyContent: "center" },
  stepTitle: { flex: 1 },
  optional: { fontSize: 13, fontWeight: "500" },
  dice: { width: 40, height: 40, borderRadius: comicRadius.iconButtonSm, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  /** 手机上：输入框和名字建议上下排，间距和步骤里其他内容一样 */
  nameColumn: { gap: 14 },
  nameChips: { flexDirection: "row", gap: space.s },
  lengths: {
    flexDirection: "row",
    borderWidth: comicStroke.control,
    borderRadius: comicRadius.input,
    overflow: "hidden",
  },
  length: { flex: 1, alignItems: "center", gap: 6, paddingTop: 12, paddingBottom: 10 },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: 10 },
  checkCell: { width: "47%" },
});
