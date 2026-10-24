/**
 * “回到更早的一段”：列出之前的每一段（最新的那段除外），新的在上面；点一段后由页面确认、回退。
 * 手机上长按正文是用来选中复制的，所以回退的入口放在“更多”里（网页是鼠标移到某一段上出现的按钮）。
 *
 * 漫画风（docs/design/comic/mobile/png/43）：一个白底墨线的格子，每段一行，左边等宽的回合号（开场写“开场”），
 * 右边你的行动（开场是正文的开头），下面一行浅色的正文摘录；按下时浅蓝底。
 */

import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { actionNote, headTurn, type PlayState } from "@bettertavern/core/play/turnMachine";

import { Group, Sheet } from "../../components/ui.tsx";
import { font, space, useComic } from "../../theme/index.ts";

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
  const c = useComic();
  const { t } = useTranslation();
  const head = headTurn(state);
  const turns = state.turns.filter((turn) => turn.id !== head?.id).reverse();
  return (
    <Sheet visible={visible} onClose={onClose} title={t("play.rollbackPickTitle")}>
      <ScrollView style={styles.list}>
        <Group>
          {turns.map((turn) => {
            const note = actionNote(turn.action);
            const opening = turn.action.source === "opening";
            return (
              <Pressable
                key={turn.id}
                accessibilityRole="button"
                onPress={() => onPick(turn.id)}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.selected : "transparent" }]}
              >
                <Text style={[styles.seq, { color: c.ink }, opening ? styles.openingLabel : null]}>
                  {opening ? t("play.rollbackOpening") : turn.seq}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2} style={[styles.action, { color: c.ink }]}>
                    {note ?? excerpt(turn.narrative)}
                  </Text>
                  {note ? (
                    <Text numberOfLines={1} style={[styles.excerpt, { color: c.mut }]}>
                      {excerpt(turn.narrative)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Group>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 480, paddingHorizontal: 18 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.m, paddingVertical: space.m, paddingHorizontal: 14 },
  seq: { width: 28, paddingTop: 2, fontFamily: font.monoMedium, fontSize: 12, fontWeight: "700" },
  openingLabel: { fontFamily: undefined, fontSize: 12.5 },
  action: { fontSize: 14.5, lineHeight: 21, fontWeight: "600" },
  excerpt: { fontSize: 12.5, lineHeight: 18 },
});
