/**
 * 外观面板：跟随系统，或固定某个主题（按主题表 THEME_ORDER 列出）。点一下立刻生效，面板不关，能直接看到效果。
 * 每项右边一小块配色预览；跟随系统的那块左右各半，是浅色和夜间。
 */

import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Group, RadioMark, Sheet } from "../../components/ui.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import {
  comicRadius,
  comicStroke,
  space,
  THEME_ORDER,
  THEMES,
  useComic,
  type Palette,
  type ThemeSetting,
} from "../../theme/index.ts";

type Option = { value: ThemeSetting; previews: Palette[] };

/** 名字和说明在 i18n 资源里：appearance.<id>、appearance.<id>Note */
const OPTIONS: Option[] = [
  { value: "system", previews: [THEMES.light.palette, THEMES.night.palette] },
  ...THEME_ORDER.map((id) => ({ value: id, previews: [THEMES[id].palette] })),
];

/** 配色预览：页面底色上一条灰卡，下面一个墨色点和一个强调色点 */
function Swatch({ previews }: { previews: Palette[] }) {
  const c = useComic();
  return (
    <View
      style={[styles.swatch, { borderWidth: comicStroke.chip, borderColor: c.ink }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {previews.map((p, i) => (
        <View key={i} style={[styles.swatchPart, { backgroundColor: p.bg }]}>
          <View style={[styles.swatchBar, { backgroundColor: p.bg2 }]} />
          <View style={styles.swatchDots}>
            <View style={[styles.swatchDot, { backgroundColor: p.ink }]} />
            <View style={[styles.swatchDot, { backgroundColor: p.acc }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function AppearanceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useComic();
  const { theme, setTheme } = usePrefs();
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} title={t("appearance.title")}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("appearance.title")} style={styles.body}>
        <Group>
          {OPTIONS.map((option) => {
            const on = theme === option.value;
            const label = t(`appearance.${option.value}`);
            const note = t(`appearance.${option.value}Note`);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${label}, ${note}`}
                onPress={() => setTheme(option.value)}
                style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.grey : "transparent" }]}
              >
                <RadioMark selected={on} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: c.ink }]}>{label}</Text>
                  <Text style={[styles.note, { color: c.mut }]}>{note}</Text>
                </View>
                <Swatch previews={option.previews} />
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
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: space.m,
  },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  note: { fontSize: 12.5, lineHeight: 18 },
  swatch: { flexDirection: "row", width: 56, height: 40, borderRadius: comicRadius.tag, overflow: "hidden" },
  swatchPart: { flex: 1, paddingHorizontal: 6, paddingTop: 7, gap: 6 },
  swatchBar: { height: 8, borderRadius: 4 },
  swatchDots: { flexDirection: "row", gap: 4 },
  swatchDot: { width: 8, height: 8, borderRadius: 4 },
});
