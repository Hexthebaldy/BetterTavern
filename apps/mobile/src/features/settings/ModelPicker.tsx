/**
 * 密钥详情页的选模型：服务商返回的模型单选列表（最多显示 40 个），搜索框兼做手动输入，右边重新获取。
 */

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ModelInfo } from "../../api/types.ts";
import { Dots, Icon, Notice, RadioMark, SectionHeader } from "../../components/ui.tsx";
import { font, onColor, space, usePalette } from "../../theme/index.ts";
import { formatTokens } from "../../utils/format.ts";

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
      <View style={[styles.search, { borderBottomColor: palette.line }]}>
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
          style={[styles.searchInput, { color: palette.ink }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新获取模型列表"
          onPress={onRefresh}
          disabled={listing}
          style={[styles.refresh, { borderLeftColor: palette.line }]}
        >
          {listing ? <Dots cell={4} gap={3} /> : <Icon name="retry" size={20} />}
        </Pressable>
      </View>
      {listError ? <Notice banner message={`${listError}。可以直接在上面输入模型名。`} /> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="模型">
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
        <Text style={[styles.footnote, { color: palette.mut, borderBottomColor: palette.line }]}>
          显示 {shown.length} / {models.length} · 最多 {MAX_LISTED} 个
        </Text>
      ) : listing ? (
        <Text style={[styles.footnote, { color: palette.mut, borderBottomColor: palette.line }]}>
          正在获取模型列表…
        </Text>
      ) : null}
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
      style={[
        styles.model,
        { borderBottomColor: palette.line, backgroundColor: selected ? palette.accBg : palette.bg },
      ]}
    >
      <RadioMark selected={selected} accent />
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
        <View
          style={[
            styles.ctx,
            selected ? { backgroundColor: palette.acc } : { borderWidth: 1, borderColor: palette.line2 },
          ]}
        >
          <Text style={{ fontFamily: font.mono, fontSize: 11, color: selected ? onColor : palette.ink2 }}>
            {formatTokens(window)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ctx: { paddingHorizontal: 6, paddingVertical: 2 },
  footnote: {
    paddingVertical: 10,
    paddingHorizontal: space.page,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 0.4,
    borderBottomWidth: 1,
  },
  model: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  refresh: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  search: { flexDirection: "row", borderBottomWidth: 1 },
  searchIcon: { position: "absolute", left: space.page, top: 15 },
  searchInput: {
    flex: 1,
    height: 48,
    paddingLeft: 48,
    paddingRight: space.m,
    fontFamily: font.mono,
    fontSize: 14,
  },
});
