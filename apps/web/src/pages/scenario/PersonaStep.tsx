/**
 * “你扮演谁”（开新故事、剧本设置的第 1 步；docs/personas.md 第 3 节）：人设库里的人设一个一块（头像加名字），
 * 后面是“临时填一个”。选了人设时下面是它的描述和“在设置 → 人设里改”；临时填的时候是名字（建议标签 + 随机）和描述，
 * 开新故事时还能勾“存进人设库”。
 * 剧本设置（mode = scenario）里最后多一块“不选”（开故事时再定）；“临时填一个”只在剧本里本来就有旧版 App 写的默认主角时出现。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Persona } from "@bettertavern/core/api/types";
import {
  initialOfName,
  PERSONA_DESCRIPTION_MAX,
  personaOf,
  SETUP_SUMMARY_MAX,
  type ProtagonistChoice,
} from "@bettertavern/core/scenario/persona";
import { NAME_MAX, randomName, suggestNames } from "@bettertavern/core/scenario/startForm";

import { Portrait } from "../../components/comic.tsx";
import { Checkbox, Chip, cx, Field, IconButton, Pill, TextArea } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./scenario.module.css";

export type PersonaTile = "persona" | "custom" | "none";

export function PersonaStep({
  mode,
  personas,
  choice,
  tile,
  showCustom,
  saveToLibrary,
  wide,
  onChoose,
  onSaveToLibrary,
}: {
  mode: "start" | "scenario";
  personas: readonly Persona[];
  choice: ProtagonistChoice;
  tile: PersonaTile;
  /** “临时填一个”这一块出不出现（剧本设置里只有原来就有默认主角时才出现） */
  showCustom: boolean;
  saveToLibrary: boolean;
  wide?: boolean;
  onChoose: (choice: ProtagonistChoice, tile: PersonaTile) => void;
  onSaveToLibrary: (value: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const suggestions = useMemo(() => suggestNames(4), [i18n.language]);
  const custom = choice.kind === "custom" ? choice : { kind: "custom" as const, name: "", summary: "" };
  const chosen = choice.kind === "persona" ? personaOf(choice.id, personas) : undefined;
  const setCustom = (next: Partial<typeof custom>): void => onChoose({ ...custom, ...next }, "custom");
  return (
    <>
      <div className={styles.personaTiles} role="radiogroup" aria-label={t("personas.pickTitle")}>
        {personas.map((persona) => {
          const on = tile === "persona" && choice.kind === "persona" && choice.id === persona.id;
          return (
            <button
              key={persona.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(styles.personaTile, on && styles.personaTileOn)}
              onClick={() => onChoose({ kind: "persona", id: persona.id }, "persona")}
            >
              <Portrait
                name={persona.name}
                seed={persona.id}
                glyph={initialOfName(persona.name)}
                blobId={persona.avatar_blob_id}
                size={36}
                radius={18}
              />
              <span className={styles.personaTileName}>{persona.name}</span>
              {persona.is_default ? <Pill tone="acc" label={t("personas.defaultBadge")} /> : null}
            </button>
          );
        })}
        {showCustom ? (
          <button
            type="button"
            role="radio"
            aria-checked={tile === "custom"}
            className={cx(styles.personaTile, styles.personaTileText, tile === "custom" && styles.personaTileOn)}
            onClick={() => onChoose(custom, "custom")}
          >
            <Icon name="write" size={18} />
            <span className={styles.personaTileName}>{t("personas.custom")}</span>
          </button>
        ) : null}
        {mode === "scenario" ? (
          <button
            type="button"
            role="radio"
            aria-checked={tile === "none"}
            className={cx(styles.personaTile, styles.personaTileText, tile === "none" && styles.personaTileOn)}
            onClick={() => onChoose({ kind: "custom", name: "", summary: "" }, "none")}
          >
            <span className={styles.personaTileName}>{t("personas.customNone")}</span>
          </button>
        ) : null}
        <Link
          to={personas.length ? "/settings/personas" : "/settings/personas?id=new"}
          className={styles.personaManage}
        >
          {personas.length ? t("personas.manage") : t("personas.goCreate")} →
        </Link>
      </div>

      {tile === "persona" && chosen ? (
        <div className={styles.personaInfo}>
          <p className={cx(styles.personaDescription, !chosen.description && styles.muted)}>
            {chosen.description || t("personas.noDescription")}
          </p>
          <Link to={`/settings/personas?id=${encodeURIComponent(chosen.id)}`} className={styles.personaEdit}>
            {t("personas.editInSettings")}
          </Link>
        </div>
      ) : null}

      {tile === "custom" ? (
        <>
          <div className={wide ? styles.nameRow : styles.nameColumn}>
            <Field
              label={t("start.nameLabel")}
              className={cx(styles.nameField, styles.hiddenLabel)}
              value={custom.name}
              onChange={(e) => setCustom({ name: e.target.value })}
              maxLength={NAME_MAX}
              placeholder={t("start.namePlaceholder")}
              trailing={
                <IconButton
                  icon="dice"
                  className={styles.dice}
                  label={t("start.randomName")}
                  iconSize={20}
                  onClick={() => setCustom({ name: randomName(custom.name) })}
                />
              }
            />
            <div className={styles.chips}>
              {suggestions.map((n) => (
                <Chip key={n} label={n} selected={custom.name.trim() === n} onClick={() => setCustom({ name: n })} />
              ))}
            </div>
          </div>
          <TextArea
            label={t("start.stepIdentity")}
            optional
            counter
            value={custom.summary}
            onChange={(e) => setCustom({ summary: e.target.value })}
            maxLength={mode === "start" ? PERSONA_DESCRIPTION_MAX : SETUP_SUMMARY_MAX}
            placeholder={t("start.identityPlaceholder")}
          />
          {mode === "start" ? (
            <Checkbox label={t("personas.saveToLibrary")} checked={saveToLibrary} onToggle={() => onSaveToLibrary(!saveToLibrary)} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
