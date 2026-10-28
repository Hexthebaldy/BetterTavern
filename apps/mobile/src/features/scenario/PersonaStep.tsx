/**
 * “你扮演谁”（开新故事、剧本设置的第 1 步；同网页端 pages/scenario/PersonaStep.tsx，docs/personas.md 第 3 节）：
 * 人设库里的人设一个一块（头像加名字），后面是“临时填一个”。选了人设时下面是它的描述和“在设置 → 人设里改”；
 * 临时填的时候是名字（建议标签 + 随机）和描述，开新故事时还能勾“存进人设库”。
 * 剧本设置（mode = scenario）里最后多一块“不选”；“临时填一个”只在剧本里本来就有旧版写的默认主角时出现。
 */

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Persona } from "@bettertavern/core/api/types";
import {
  PERSONA_DESCRIPTION_MAX,
  personaOf,
  SETUP_SUMMARY_MAX,
  type ProtagonistChoice,
} from "@bettertavern/core/scenario/persona";
import { NAME_MAX, randomName, suggestNames } from "@bettertavern/core/scenario/startForm";

import { Portrait } from "../../components/Portrait.tsx";
import { Checkbox, Chip, Field, Icon, Pill, press } from "../../components/ui.tsx";
import { comicDepth, comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";

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
  showCustom: boolean;
  saveToLibrary: boolean;
  wide?: boolean;
  onChoose: (choice: ProtagonistChoice, tile: PersonaTile) => void;
  onSaveToLibrary: (value: boolean) => void;
}) {
  const c = useComic();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const suggestions = useMemo(() => suggestNames(4), [i18n.language]);
  const custom = choice.kind === "custom" ? choice : { kind: "custom" as const, name: "", summary: "" };
  const chosen = choice.kind === "persona" ? personaOf(choice.id, personas) : undefined;
  const setCustom = (next: Partial<typeof custom>): void => onChoose({ ...custom, ...next }, "custom");
  const tileStyle = (on: boolean, pressed: boolean) => [
    styles.tile,
    { borderColor: on ? c.ink : c.grey2, backgroundColor: c.paper },
    on ? press(pressed, comicDepth.focus, c.ink) : pressed ? { backgroundColor: c.grey } : null,
  ];
  const openSettings = (id?: string): void =>
    router.push(id ? { pathname: "/settings/persona/[id]", params: { id } } : "/settings/personas");
  return (
    <>
      <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={t("personas.pickTitle")}>
        {personas.map((persona) => {
          const on = tile === "persona" && choice.kind === "persona" && choice.id === persona.id;
          return (
            <Pressable
              key={persona.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChoose({ kind: "persona", id: persona.id }, "persona")}
              style={({ pressed }) => tileStyle(on, pressed)}
            >
              <Portrait name={persona.name} seed={persona.id} blobId={persona.avatar_blob_id} size={32} rounded={16} />
              <Text numberOfLines={1} style={[styles.tileName, { color: c.ink }]}>
                {persona.name}
              </Text>
              {persona.is_default ? <Pill tone="acc" label={t("personas.defaultBadge")} height={22} /> : null}
            </Pressable>
          );
        })}
        {showCustom ? (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: tile === "custom" }}
            onPress={() => onChoose(custom, "custom")}
            style={({ pressed }) => [tileStyle(tile === "custom", pressed), styles.textTile]}
          >
            <Icon name="write" size={18} color={c.ink} />
            <Text style={[styles.tileName, { color: c.ink }]}>{t("personas.custom")}</Text>
          </Pressable>
        ) : null}
        {mode === "scenario" ? (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: tile === "none" }}
            onPress={() => onChoose({ kind: "custom", name: "", summary: "" }, "none")}
            style={({ pressed }) => [tileStyle(tile === "none", pressed), styles.textTile]}
          >
            <Text style={[styles.tileName, { color: c.ink }]}>{t("personas.customNone")}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="link" onPress={() => openSettings(personas.length ? undefined : "new")}>
        <Text style={[styles.link, { color: c.mut }]}>
          {personas.length ? t("personas.manage") : t("personas.goCreate")} →
        </Text>
      </Pressable>

      {tile === "persona" && chosen ? (
        <View style={{ gap: 6 }}>
          <Text numberOfLines={4} style={[styles.description, { color: chosen.description ? c.ink2 : c.mut }]}>
            {chosen.description || t("personas.noDescription")}
          </Text>
          <Pressable accessibilityRole="link" onPress={() => openSettings(chosen.id)}>
            <Text style={[styles.link, { color: c.acc }]}>{t("personas.editInSettings")}</Text>
          </Pressable>
        </View>
      ) : null}

      {tile === "custom" ? (
        <>
          <View style={wide ? styles.nameRow : styles.nameColumn}>
            <Field
              label={t("start.nameLabel")}
              hideLabel
              value={custom.name}
              onChangeText={(name) => setCustom({ name })}
              maxLength={NAME_MAX}
              placeholder={t("start.namePlaceholder")}
              style={wide ? { flex: 1 } : undefined}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("start.randomName")}
                  onPress={() => setCustom({ name: randomName(custom.name) })}
                  style={({ pressed }) => [styles.dice, { backgroundColor: pressed ? c.grey : "transparent" }]}
                >
                  <Icon name="dice" size={22} color={c.ink} />
                </Pressable>
              }
            />
            <View style={wide ? styles.nameChips : styles.wrap}>
              {suggestions.map((n) => (
                <Chip key={n} label={n} selected={custom.name.trim() === n} onPress={() => setCustom({ name: n })} />
              ))}
            </View>
          </View>
          <Field
            label={t("start.stepIdentity")}
            optional
            multiline
            counter
            value={custom.summary}
            onChangeText={(summary) => setCustom({ summary })}
            maxLength={mode === "start" ? PERSONA_DESCRIPTION_MAX : SETUP_SUMMARY_MAX}
            placeholder={t("start.identityPlaceholder")}
          />
          {mode === "start" ? (
            <Checkbox
              label={t("personas.saveToLibrary")}
              checked={saveToLibrary}
              onToggle={() => onSaveToLibrary(!saveToLibrary)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderWidth: comicStroke.control,
    borderRadius: comicRadius.input,
  },
  textTile: { paddingLeft: 12 },
  tileName: { fontSize: 15, fontWeight: "700", maxWidth: 160 },
  link: { fontSize: 13.5, fontWeight: "700" },
  description: { fontSize: 14.5, lineHeight: 22 },
  dice: { width: 40, height: 40, borderRadius: comicRadius.iconButtonSm, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  nameColumn: { gap: 14 },
  nameChips: { flexDirection: "row", gap: space.s },
});
