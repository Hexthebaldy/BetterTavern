/**
 * “回到更早的一段”：列出之前的每一段（最新的那段除外），新的在上面；点一段后由页面确认、回退。
 * 手机上长按正文是用来选中复制的，所以回退的入口放在“更多”里（网页是鼠标移到某一段上出现的按钮）。
 */

import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { actionNote, headTurn, type PlayState } from "@bettertavern/core/play/turnMachine";

import { Sheet } from "../../components/ui.tsx";
import { space, usePalette } from "../../theme/index.ts";

function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function RollbackSheet({
  visible,
  onClose,
  state,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  state: PlayState;
  onPick: (turnId: string) => void;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const head = headTurn(state);
  const turns = state.turns.filter((turn) => turn.id !== head?.id).reverse();
  return (
    <Sheet visible={visible} onClose={onClose} title={t("play.rollbackPickTitle")}>
      <ScrollView style={styles.list} contentContainerStyle={{ gap: space.xs }}>
        {turns.map((turn) => (
          <Pressable
            key={turn.id}
            accessibilityRole="button"
            onPress={() => onPick(turn.id)}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : palette.bg2 }]}
          >
            <Text numberOfLines={1} style={[styles.action, { color: palette.ink }]}>
              {actionNote(turn.action) ?? t("play.rollbackOpening")}
            </Text>
            <Text numberOfLines={2} style={[styles.excerpt, { color: palette.mut }]}>
              {excerpt(turn.narrative)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 480, paddingHorizontal: space.s },
  row: { borderRadius: 18, paddingHorizontal: space.m, paddingVertical: space.s, gap: 2 },
  action: { fontSize: 15, lineHeight: 21, fontWeight: "500" },
  excerpt: { fontSize: 13, lineHeight: 19 },
});
