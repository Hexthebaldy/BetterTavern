/**
 * 添加模型时的选模型：服务商返回的模型单选列表（最多显示 40 个），搜索框兼做手动输入，右边重新获取。
 * 每个模型右边是它的上下文长度（服务商列表或内置资料给的）。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ModelInfo } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";

import { Dots, Group, Icon, Notice, press, RadioMark, SectionHeader } from "../../components/ui.tsx";
import { comicDepth, comicRadius, comicStroke, font, space, useComic } from "../../theme/index.ts";

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
  const c = useComic();
  const { t } = useTranslation();
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
      <SectionHeader
        title={t("models.pick")}
        meta={models ? t("models.available", { count: models.length }) : undefined}
      />
      <View style={styles.card}>
        <View style={styles.search}>
          <View style={styles.searchIcon} pointerEvents="none">
            <Icon name="search" size={18} color={c.mut} />
          </View>
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder={t("models.search")}
            placeholderTextColor={c.mut}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("models.search")}
            selectionColor={c.acc}
            style={[styles.searchInput, { color: c.ink, backgroundColor: c.paper, borderColor: c.ink }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("models.refetchList")}
            onPress={onRefresh}
            disabled={listing}
            style={({ pressed }) => [
              styles.refresh,
              { backgroundColor: c.paper, borderColor: c.ink },
              press(pressed && !listing, comicDepth.iconButton, c.ink),
            ]}
          >
            {listing ? <Dots cell={4} gap={3} /> : <Icon name="retry" size={18} />}
          </Pressable>
        </View>
        {listError ? (
          <Notice message={t("models.listErrorHint", { error: listError })} />
        ) : null}
        <View accessibilityRole="radiogroup" accessibilityLabel={t("models.listLabel")}>
          {manual || shown.length ? (
            <Group>
              {manual ? (
                <ModelRow
                  id={typed}
                  label={t("models.useTyped", { name: typed })}
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
            </Group>
          ) : null}
        </View>
        {models ? (
          <Text style={[styles.footnote, { color: c.mut }]}>
            {t("models.shown", { shown: shown.length, total: models.length, max: MAX_LISTED })}
          </Text>
        ) : listing ? (
          <Text style={[styles.footnote, { color: c.mut }]}>{t("models.fetching")}</Text>
        ) : listError ? null : (
          <Text style={[styles.footnote, { color: c.mut }]}>{t("models.fetchHint")}</Text>
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
  const c = useComic();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label ?? id}
      onPress={onPress}
      style={({ pressed }) => [styles.model, { backgroundColor: pressed ? c.grey : "transparent" }]}
    >
      <RadioMark selected={selected} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily: font.monoMedium,
          fontSize: 14.5,
          fontWeight: selected ? "700" : "normal",
          color: c.ink,
        }}
      >
        {label ?? id}
      </Text>
      {window ? (
        <Text style={{ fontFamily: font.mono, fontSize: 12.5, color: c.mut }}>{formatTokens(window)}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, gap: 10 },
  footnote: { paddingHorizontal: space.xs, fontSize: 12 },
  model: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 54, paddingHorizontal: 14 },
  refresh: {
    width: 48,
    height: 48,
    borderRadius: comicRadius.iconButton,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  search: { flexDirection: "row", gap: space.s },
  searchIcon: { position: "absolute", left: 14, top: 15, zIndex: 1 },
  searchInput: {
    flex: 1,
    height: 48,
    borderRadius: comicRadius.input,
    borderWidth: comicStroke.control,
    paddingLeft: 42,
    paddingRight: space.m,
    fontFamily: font.mono,
    fontSize: 14,
  },
});
