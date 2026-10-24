/**
 * 语言面板：跟随系统、中文、English、日本語。点一下立刻生效，面板不关，能直接看到效果。
 * 每种语言用它自己的文字写，不翻译；“跟随系统”下面注明系统现在是哪种语言。
 * 界面语言只决定界面文字和新开故事的提示词语言，不影响已有的存档（docs/i18n.md）。
 */

import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LANGUAGE_NAMES, LANGUAGES, type LanguageSetting } from "@bettertavern/core/i18n/index";

import { Group, RadioMark, Sheet } from "../../components/ui.tsx";
import { useSystemLanguage } from "../../state/language.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { space, useComic } from "../../theme/index.ts";

export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useComic();
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
        <Group>
          {options.map((option) => {
            const on = language === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={option.note ? `${option.label}, ${option.note}` : option.label}
                onPress={() => setLanguage(option.value)}
                style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.grey : "transparent" }]}
              >
                <RadioMark selected={on} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: c.ink }]}>{option.label}</Text>
                  {option.note ? (
                    <Text style={[styles.note, { color: c.mut }]}>{option.note}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Group>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: space.s },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: space.m,
  },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  note: { fontSize: 12.5, lineHeight: 18 },
});
