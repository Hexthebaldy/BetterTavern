/**
 * “开始新的故事”的五步表单（同 App 的 StartForm.tsx）：名字（建议标签 + 随机）、这个角色是谁（一个多行输入框）、
 * 篇幅（行数图示）、文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口原来的字段，见 @bettertavern/core 的 scenario/startForm.ts。
 * 宽屏（wide）：名字建议排在输入框右边。
 * initial：按剧本设置预填（默认主角、偏好）；不在内置标签里的文风、不想看到的内容当作自定义的项。
 * 也用在新建、编辑剧本（ScenarioFormPage.tsx）里填剧本的默认设置。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Preferences } from "@bettertavern/core/api/types";
import {
  boundaryItems,
  composeBoundaries,
  composeStyle,
  lengthLabel,
  NAME_MAX,
  randomName,
  splitJoined,
  styleTags as builtinStyles,
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
  initial,
}: {
  onChange: (values: StartValues, summary: string[]) => void;
  wide?: boolean;
  initial?: StartValues;
}) {
  const overlay = useOverlay();
  const { t, i18n } = useTranslation();
  // 名字建议、内置的文风和边界随界面语言
  const suggestions = useMemo(() => suggestNames(4), [i18n.language]);
  const builtinTags = useMemo(() => builtinStyles(), [i18n.language]);
  const avoidItems = useMemo(() => boundaryItems(), [i18n.language]);
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [length, setLength] = useState<Preferences["length"]>(initial?.length ?? "medium");
  const [styleTags, setStyleTags] = useState<string[]>(() => splitJoined(initial?.style ?? ""));
  const [customStyles, setCustomStyles] = useState<string[]>(() =>
    splitJoined(initial?.style ?? "").filter((tag) => !builtinTags.includes(tag)),
  );
  const [bounds, setBounds] = useState<string[]>(() => splitJoined(initial?.boundaries ?? ""));
  const [customBounds, setCustomBounds] = useState<string[]>(() =>
    splitJoined(initial?.boundaries ?? "").filter((item) => !avoidItems.includes(item)),
  );

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
    // 换了界面语言，底部摘要（“还没起名”“适中”）也要换
  }, [name, summary, length, styleTags, bounds, i18n.language]);

  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  const addUnique = (item: string) => (list: string[]) => (list.includes(item) ? list : [...list, item]);

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
      setCustomStyles(addUnique(text));
      setStyleTags(addUnique(text));
    } else {
      setCustomBounds(addUnique(text));
      setBounds(addUnique(text));
    }
  };

  return (
    <div className={styles.steps}>
      <Step n="1" title={t("start.stepWho")}>
        <div className={wide ? styles.nameRow : styles.nameColumn}>
          <Field
            label={t("start.nameLabel")}
            className={cx(styles.nameField, styles.hiddenLabel)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder={t("start.namePlaceholder")}
            trailing={
              <IconButton
                icon="dice"
                className={styles.dice}
                label={t("start.randomName")}
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

      <Step n="2" title={t("start.stepIdentity")} optional={t("common.optional")}>
        <TextArea
          label={t("start.stepIdentity")}
          hideLabel
          counter
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={SUMMARY_MAX}
          placeholder={t("start.identityPlaceholder")}
        />
      </Step>

      <Step n="3" title={t("start.stepLength")}>
        <div className={styles.lengths} role="radiogroup" aria-label={t("start.stepLength")}>
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
                <span>{lengthLabel(value)}</span>
              </button>
            );
          })}
        </div>
      </Step>

      <Step n="4" title={t("start.stepStyle")} optional={t("start.optionalMulti")}>
        <div className={styles.chips}>
          {[...builtinTags, ...customStyles].map((tag) => (
            <Chip
              key={tag}
              label={tag}
              check
              selected={styleTags.includes(tag)}
              onClick={() => setStyleTags((list) => toggle(list, tag))}
            />
          ))}
          <Chip label={t("start.customStyle")} icon="plus" accent onClick={() => void addCustom("style")} />
        </div>
      </Step>

      <Step n="5" title={t("start.stepAvoid")} optional={t("common.optional")}>
        <div className={styles.checks}>
          {[...avoidItems, ...customBounds].map((item) => (
            <Checkbox
              key={item}
              label={item}
              checked={bounds.includes(item)}
              onToggle={() => setBounds((list) => toggle(list, item))}
            />
          ))}
          <Checkbox label={t("start.other")} checked={false} plus onToggle={() => void addCustom("bound")} />
        </div>
      </Step>
    </div>
  );
}
