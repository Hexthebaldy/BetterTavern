/**
 * 添加模型时的选模型：服务商返回的模型单选列表（最多显示 40 个），搜索框兼做手动输入，右边重新获取。
 * 每个模型右边是它的上下文长度（服务商列表或内置资料给的）。
 */

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ModelInfo } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";

import { Dots, Icon, Notice, RadioMark, SectionHeader } from "../../components/ui.tsx";
import { font, space, usePalette } from "../../theme/index.ts";

const MAX_LISTED = 40;

export function ModelPicker({
  models,
  listing,
  listError,
  query,
  onQuery,
  chosen,
  onPick,
  onRefresh,
}: {
  models: ModelInfo[] | null;
  listing: boolean;
  listError: string | null;
  query: string;
  onQuery: (text: string) => void;
  chosen: string;
  onPick: (id: string) => void;
  onRefresh: () => void;
}) {
  const palette = usePalette();
  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  }, [models, query]);
  const shown = filtered.slice(0, MAX_LISTED);
  const typed = query.trim();
  const manual = typed !== "" && !models?.some((m) => m.id === typed);
  return (
    <View>
      <SectionHeader title="选择模型" meta={models ? `${models.length} 个可用` : undefined} />
      <View style={[styles.card, { backgroundColor: palette.bg2 }]}>
        <View style={styles.search}>
          <View style={styles.searchIcon} pointerEvents="none">
            <Icon name="search" size={18} color={palette.mut} />
          </View>
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="搜索或输入模型名"
            placeholderTextColor={palette.mut}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="搜索或输入模型名"
            style={[styles.searchInput, { color: palette.ink, backgroundColor: palette.card }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新获取模型列表"
            onPress={onRefresh}
            disabled={listing}
            style={({ pressed }) => [
              styles.refresh,
              { backgroundColor: palette.card, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            {listing ? <Dots cell={4} gap={3} /> : <Icon name="retry" size={18} />}
          </Pressable>
        </View>
        {listError ? (
          <Notice message={`${listError}。可以直接在上面输入模型名。`} style={{ borderRadius: 18 }} />
        ) : null}
        <View accessibilityRole="radiogroup" accessibilityLabel="模型" style={{ gap: 4 }}>
          {manual ? (
            <ModelRow
              id={typed}
              label={`使用“${typed}”`}
              window={null}
              selected={chosen === typed}
              onPress={() => onPick(typed)}
            />
          ) : null}
          {shown.map((m) => (
            <ModelRow
              key={m.id}
              id={m.id}
              window={m.context_window}
              selected={chosen === m.id}
              onPress={() => onPick(m.id)}
            />
          ))}
        </View>
        {models ? (
          <Text style={[styles.footnote, { color: palette.mut }]}>
            显示 {shown.length} / {models.length}，最多 {MAX_LISTED} 个
          </Text>
        ) : listing ? (
          <Text style={[styles.footnote, { color: palette.mut }]}>正在获取模型列表…</Text>
        ) : listError ? null : (
          <Text style={[styles.footnote, { color: palette.mut }]}>
            填好 Key 后会自动获取模型列表，也可以直接在上面输入模型名。
          </Text>
        )}
      </View>
    </View>
  );
}

function ModelRow({
  id,
  label,
  window,
  selected,
  onPress,
}: {
  id: string;
  label?: string;
  window: number | null;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label ?? id}
      onPress={onPress}
      style={({ pressed }) => [
        styles.model,
        selected
          ? { backgroundColor: palette.card, boxShadow: `inset 0 0 0 2px ${palette.acc}` }
          : { backgroundColor: pressed ? palette.bg3 : "transparent" },
      ]}
    >
      <RadioMark selected={selected} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily: selected ? font.monoMedium : font.mono,
          fontSize: 14,
          color: palette.ink,
        }}
      >
        {label ?? id}
      </Text>
      {window ? (
        <View style={[styles.ctx, { backgroundColor: selected ? palette.accBg : palette.card }]}>
          <Text
            style={{ fontFamily: font.mono, fontSize: 11.5, color: selected ? palette.acc : palette.ink2 }}
          >
            {formatTokens(window)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.list, padding: space.s, borderRadius: 30, gap: 4 },
  ctx: { height: 24, paddingHorizontal: 9, borderRadius: 12, justifyContent: "center" },
  footnote: { paddingTop: 6, paddingBottom: space.xs, paddingHorizontal: 14, fontSize: 12 },
  model: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  refresh: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", gap: 6, marginBottom: space.xs },
  searchIcon: { position: "absolute", left: 14, top: 13, zIndex: 1 },
  searchInput: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingLeft: 42,
    paddingRight: space.m,
    fontFamily: font.mono,
    fontSize: 14,
  },
});
