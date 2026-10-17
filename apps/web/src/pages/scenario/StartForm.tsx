/**
 * “开始新的故事”的五步表单（同 App 的 StartForm.tsx）：名字（建议标签 + 随机）、这个角色是谁（一个多行输入框）、
 * 篇幅（行数图示）、文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口原来的字段，见 @bettertavern/core 的 scenario/startForm.ts。
 * 宽屏（wide）：名字建议排在输入框右边。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

import { Checkbox, Chip, cx, Field, IconButton, TextArea } from "../../components/controls.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import styles from "./scenario.module.css";

export type StartValues = {
  name: string;
  summary: string;
  length: Preferences["length"];
  style: string;
  boundaries: string;
};

/** 一步：灰色圆角卡片，标题前一个白色圆形序号；里面的输入框、标签是白的 */
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
  return (
    <section className={cx(styles.step, "surface-panel")} aria-label={title}>
      <div className={styles.stepHead}>
        <span className={styles.stepNo}>{n}</span>
        <h3 className={styles.stepTitle}>
          {title}
          {optional ? <span className={styles.optional}> {optional}</span> : null}
        </h3>
      </div>
      {children}
    </section>
  );
}

/** 篇幅图示：几行圆头的横线，越长行数越多 */
const LENGTH_GLYPHS: Record<Preferences["length"], { d: string; width: number }> = {
  short: { d: "M2 4h32M2 11h20", width: 2.4 },
  medium: { d: "M2 4h32M2 11h32M2 18h22", width: 2.4 },
  long: { d: "M2 2h32M2 7h32M2 12h32M2 17h32M2 21h16", width: 2 },
};

export function StartForm({
  onChange,
  wide,
}: {
  onChange: (values: StartValues, summary: string[]) => void;
  wide?: boolean;
}) {
  const overlay = useOverlay();
  const suggestions = useMemo(() => suggestNames(4), []);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [length, setLength] = useState<Preferences["length"]>("medium");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [customStyles, setCustomStyles] = useState<string[]>([]);
  const [bounds, setBounds] = useState<string[]>([]);
  const [customBounds, setCustomBounds] = useState<string[]>([]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(
      {
        name: name.trim(),
        summary: summary.trim(),
        length,
        style: composeStyle(styleTags),
        boundaries: composeBoundaries(bounds),
      },
      summaryParts({ name, length, styles: styleTags, boundaries: bounds.length }),
    );
  }, [name, summary, length, styleTags, bounds]);

  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  const addUnique = (item: string) => (list: string[]) => (list.includes(item) ? list : [...list, item]);

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
      setCustomStyles(addUnique(text));
      setStyleTags(addUnique(text));
    } else {
      setCustomBounds(addUnique(text));
      setBounds(addUnique(text));
    }
  };

  return (
    <div className={styles.steps}>
      <Step n="1" title="你扮演谁">
        <div className={wide ? styles.nameRow : styles.nameColumn}>
          <Field
            label="主角的名字"
            className={cx(styles.nameField, styles.hiddenLabel)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder="名字"
            trailing={
              <IconButton
                icon="dice"
                className={styles.dice}
                label="随机一个名字"
                iconSize={20}
                onClick={() => setName(randomName(name))}
              />
            }
          />
          <div className={styles.chips}>
            {suggestions.map((n) => (
              <Chip key={n} label={n} selected={name.trim() === n} onClick={() => setName(n)} />
            ))}
          </div>
        </div>
      </Step>

      <Step n="2" title="这个角色是谁" optional="可选">
        <TextArea
          label="这个角色是谁"
          hideLabel
          counter
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={SUMMARY_MAX}
          placeholder="身份、来历、和卡里角色的关系"
        />
      </Step>

      <Step n="3" title="每段的长度">
        <div className={styles.lengths} role="radiogroup" aria-label="每段的长度">
          {(["short", "medium", "long"] as const).map((value) => {
            const on = length === value;
            const glyph = LENGTH_GLYPHS[value];
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                className={cx(styles.length, on && styles.lengthOn)}
                onClick={() => setLength(value)}
              >
                <svg width={36} height={22} viewBox="0 0 36 22" aria-hidden="true">
                  <path d={glyph.d} stroke="currentColor" strokeWidth={glyph.width} strokeLinecap="round" />
                </svg>
                <span>{LENGTH_LABELS[value]}</span>
              </button>
            );
          })}
        </div>
      </Step>

      <Step n="4" title="文风" optional="可选 · 可多选">
        <div className={styles.chips}>
          {[...STYLE_TAGS, ...customStyles].map((tag) => (
            <Chip
              key={tag}
              label={tag}
              check
              selected={styleTags.includes(tag)}
              onClick={() => setStyleTags((list) => toggle(list, tag))}
            />
          ))}
          <Chip label="自定义" icon="plus" accent onClick={() => void addCustom("style")} />
        </div>
      </Step>

      <Step n="5" title="不想看到的内容" optional="可选">
        <div className={styles.checks}>
          {[...BOUNDARY_ITEMS, ...customBounds].map((item) => (
            <Checkbox
              key={item}
              label={item}
              checked={bounds.includes(item)}
              onToggle={() => setBounds((list) => toggle(list, item))}
            />
          ))}
          <Checkbox label="其他…" checked={false} plus onToggle={() => void addCustom("bound")} />
        </div>
      </Step>
    </div>
  );
}
