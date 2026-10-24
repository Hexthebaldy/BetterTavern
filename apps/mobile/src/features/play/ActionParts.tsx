/**
 * 阅读页的两块输入：选项行（TurnActions.tsx，接在故事流末尾）和自由输入（底部操作栏 BottomBar.tsx 展开后）。
 *
 * 选项（漫画风）：灰底 #EEEEEA、2.5 墨线、圆角 14、墨投影 4；左边 26 见方的墨底字母块；黑体 700，16/24。
 * 按下或选中时变成墨底白字，往投影方向挪 3、投影剩 1。
 * 自由输入：2.5 蓝框加蓝投影 3，宋体 16/25；下面是“收起”（次要）和“发送”（主按钮）。
 */

import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import type { TurnOption } from "@bettertavern/core/api/types";

import { Button, press } from "../../components/ui.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  ctype,
  font,
  hardShadow,
  serifFor,
  space,
  useComic,
} from "../../theme/index.ts";

const MAX_TEXT = 2000;
const KEYS = ["A", "B", "C", "D"];

export function OptionRow({
  option,
  index,
  disabled,
  chosen,
  dimmed,
  onPress,
  style,
}: {
  option: TurnOption;
  index: number;
  disabled: boolean;
  chosen: boolean;
  dimmed: boolean;
  onPress: () => void;
  /** 平板宽屏排两列时的宽度和最小高度 */
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("play.optionLabel", { key: KEYS[index] ?? "", text: option.text })}
      accessibilityHint={t("play.chooseHint")}
      accessibilityState={{ disabled, selected: chosen }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        const on = chosen || pressed;
        return [
          styles.option,
          { borderColor: c.ink, backgroundColor: on ? c.ink : c.option, opacity: dimmed ? 0.4 : 1 },
          press(on, comicDepth.raised, c.ink),
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const on = chosen || pressed;
        return (
          <>
            <View style={[styles.key, { backgroundColor: on ? c.paper : c.ink }]}>
              <Text style={[styles.keyText, { color: on ? c.ink : c.paper }]}>{KEYS[index] ?? "·"}</Text>
            </View>
            <Text style={[ctype.option, styles.optionText, { color: on ? c.paper : c.ink }]}>{option.text}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

export function FreeInput({
  draft,
  onDraft,
  disabled,
  onSend,
  onClose,
  language,
}: {
  draft: string;
  onDraft: (text: string) => void;
  disabled: boolean;
  onSend: (text: string) => void;
  /** 没有选项时没法收起 */
  onClose: (() => void) | null;
  /** 这一局的语言：输入框的宋体按它选 */
  language: string;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
  const blocked = disabled || !trimmed;
  return (
    <View style={styles.inputBlock}>
      <TextInput
        value={draft}
        onChangeText={onDraft}
        placeholder={t("play.inputPlaceholder")}
        placeholderTextColor={c.mut}
        selectionColor={c.acc}
        multiline
        autoFocus={onClose !== null}
        maxLength={MAX_TEXT}
        accessibilityLabel={t("play.inputLabel")}
        style={[
          styles.input,
          {
            fontFamily: serifFor(language),
            color: c.ink,
            backgroundColor: c.paper,
            borderColor: c.acc,
            boxShadow: hardShadow(c.acc, comicDepth.focus),
          },
        ]}
      />
      <View style={styles.inputRow}>
        {onClose ? (
          <Button label={t("common.collapse")} icon="chevronDown" variant="secondary" small onPress={onClose} />
        ) : null}
        {left <= 200 ? (
          <Text style={[styles.left, { color: c.mut }]}>{t("play.left", { n: left })}</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Button label={t("play.send")} icon="send" small disabled={blocked} onPress={() => onSend(trimmed)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.m,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.option,
  },
  key: {
    width: 26,
    height: 26,
    marginTop: -1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontFamily: font.monoMedium, fontSize: 13, fontWeight: "700" },
  optionText: { flex: 1 },
  inputBlock: { gap: 10 },
  input: {
    height: 124,
    borderWidth: comicStroke.frame,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.s, paddingBottom: comicDepth.raised },
  left: { fontFamily: font.mono, fontSize: 12 },
});
