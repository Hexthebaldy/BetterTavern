/**
 * 语言面板：跟随系统、中文、English。点一下立刻生效，面板不关，能直接看到效果。
 * “中文”“English”用各自的语言写，不翻译；“跟随系统”下面注明系统现在是哪种语言。
 * 界面语言只决定界面文字和新开故事的提示词语言，不影响已有的存档（docs/i18n.md）。
 */

import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LANGUAGE_NAMES, LANGUAGES, type LanguageSetting } from "@bettertavern/core/i18n/index";

import { RadioMark, Sheet, useSheetSurfaces } from "../../components/ui.tsx";
import { useSystemLanguage } from "../../state/language.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";

export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const { t } = useTranslation();
  const { language, setLanguage } = usePrefs();
  const system = useSystemLanguage();
  const options: { value: LanguageSetting; label: string; note?: string }[] = [
    {
      value: "system",
      label: t("language.system"),
      note: t("language.systemNote", { language: LANGUAGE_NAMES[system] }),
    },
    ...LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t("language.title")}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("language.title")} style={styles.body}>
        {options.map((option) => {
          const on = language === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option.note ? `${option.label}, ${option.note}` : option.label}
              onPress={() => setLanguage(option.value)}
              style={({ pressed }) => [
                styles.option,
                on
                  ? { backgroundColor: palette.accBg, boxShadow: `inset 0 0 0 2px ${palette.acc}` }
                  : { backgroundColor: surfaces.fill },
                { transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <RadioMark selected={on} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: palette.ink }]}>{option.label}</Text>
                {option.note ? (
                  <Text style={[styles.note, { color: palette.mut }]}>{option.note}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.l, paddingBottom: space.s, gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.card,
  },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "500" },
  note: { fontSize: 12.5, lineHeight: 18 },
});
