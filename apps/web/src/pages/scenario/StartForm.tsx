/**
 * “开始新的故事”的四步表单（同 App 的 StartForm.tsx）：你扮演谁（人设库里选一个，或者临时填名字和描述，见 PersonaStep.tsx）、
 * 篇幅（行数图示）、文风（多选标签 + 自定义）、不想看到的内容（勾选清单 + 其他）。只有第 1 步必填。
 * 选择最终拼回接口的字段，见 @bettertavern/core 的 scenario/startForm.ts、scenario/persona.ts。
 * 宽屏（wide）：名字建议排在输入框右边。
 * initial：按剧本设置预填（先选哪个人设、偏好）；不在内置标签里的文风、不想看到的内容当作自定义的项。
 * 也用在新建、编辑剧本（ScenarioFormPage.tsx，mode = scenario）里填剧本的默认设置：第 1 步是默认人设，可以不选。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Persona, Preferences } from "@bettertavern/core/api/types";
import { choiceName, type ProtagonistChoice } from "@bettertavern/core/scenario/persona";
import {
  boundaryItems,
  composeBoundaries,
  composeStyle,
  lengthLabel,
  splitJoined,
  styleTags as builtinStyles,
  summaryParts,
} from "@bettertavern/core/scenario/startForm";

import { Checkbox, Chip, cx } from "../../components/controls.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { PersonaStep, type PersonaTile } from "./PersonaStep.tsx";
import styles from "./scenario.module.css";

export type StartValues = {
  /** 你扮演谁：人设，或者临时填的（剧本设置里名字为空表示不选） */
  choice: ProtagonistChoice;
  /** 开新故事时临时填的要不要存进人设库 */
  saveToLibrary: boolean;
  length: Preferences["length"];
  style: string;
  boundaries: string;
};

export type StartInitial = {
  choice: ProtagonistChoice;
  length?: Preferences["length"];
  style?: string;
  boundaries?: string;
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
  personas,
  mode = "start",
}: {
  onChange: (values: StartValues, summary: string[]) => void;
  wide?: boolean;
  initial: StartInitial;
  personas: readonly Persona[];
  mode?: "start" | "scenario";
}) {
  const overlay = useOverlay();
  const { t, i18n } = useTranslation();
  // 内置的文风和边界随界面语言
  const builtinTags = useMemo(() => builtinStyles(), [i18n.language]);
  const avoidItems = useMemo(() => boundaryItems(), [i18n.language]);
  const [choice, setChoice] = useState<ProtagonistChoice>(initial.choice);
  const startsCustom = initial.choice.kind === "custom" && initial.choice.name !== "";
  const [tile, setTile] = useState<PersonaTile>(
    initial.choice.kind === "persona" ? "persona" : startsCustom || mode === "start" ? "custom" : "none",
  );
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [length, setLength] = useState<Preferences["length"]>(initial.length ?? "medium");
  const [styleTags, setStyleTags] = useState<string[]>(() => splitJoined(initial.style ?? ""));
  const [customStyles, setCustomStyles] = useState<string[]>(() =>
    splitJoined(initial.style ?? "").filter((tag) => !builtinTags.includes(tag)),
  );
  const [bounds, setBounds] = useState<string[]>(() => splitJoined(initial.boundaries ?? ""));
  const [customBounds, setCustomBounds] = useState<string[]>(() =>
    splitJoined(initial.boundaries ?? "").filter((item) => !avoidItems.includes(item)),
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(
      {
        choice,
        saveToLibrary: tile === "custom" && saveToLibrary,
        length,
        style: composeStyle(styleTags),
        boundaries: composeBoundaries(bounds),
      },
      summaryParts({ name: choiceName(choice, personas), length, styles: styleTags, boundaries: bounds.length }),
    );
    // 换了界面语言，底部摘要（“还没起名”“适中”）也要换
  }, [choice, tile, saveToLibrary, personas, length, styleTags, bounds, i18n.language]);

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
        <PersonaStep
          mode={mode}
          personas={personas}
          choice={choice}
          tile={tile}
          showCustom={mode === "start" || startsCustom}
          saveToLibrary={saveToLibrary}
          wide={wide}
          onChoose={(next, nextTile) => {
            setChoice(next);
            setTile(nextTile);
          }}
          onSaveToLibrary={setSaveToLibrary}
        />
      </Step>

      <Step n="2" title={t("start.stepLength")}>
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

      <Step n="3" title={t("start.stepStyle")} optional={t("start.optionalMulti")}>
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

      <Step n="4" title={t("start.stepAvoid")} optional={t("common.optional")}>
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
