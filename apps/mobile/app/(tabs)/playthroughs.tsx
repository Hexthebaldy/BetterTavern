/** 故事列表：最近玩过的在前；长按可以删除 */

import { useRouter } from "expo-router";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { Playthrough } from "../../src/api/types.ts";
import { Body, Button, Centered, ListRow, Loading, Notice, Title } from "../../src/components/ui.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";
import { formatRelative } from "../../src/utils/format.ts";

function subtitle(pt: Playthrough): string {
  if (pt.active_turn_id) return pt.head_excerpt ? `正在写下一段。${pt.head_excerpt}` : "正在写开场…";
  return pt.head_excerpt || "开场还没有写好";
}

export default function PlaythroughsScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => api.playthroughs.list(),
    [api],
  );

  const remove = (pt: Playthrough): void => {
    Alert.alert(`删除“${pt.title}”？`, "删除后故事和世界状态都无法恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          api.playthroughs
            .remove(pt.id)
            .then(() => setData((list) => list?.filter((p) => p.id !== pt.id)))
            .catch((e: unknown) => Alert.alert("删除失败", describeError(e)));
        },
      },
    ]);
  };

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Centered>
        <Body style={{ marginBottom: space.l, textAlign: "center" }}>{describeError(error)}</Body>
        <Button label="重新加载" onPress={() => void reload()} />
      </Centered>
    );
  }
  if (data.length === 0) {
    return (
      <Centered>
        <Title style={{ marginBottom: space.s }}>还没有故事</Title>
        <Body style={{ color: palette.muted, marginBottom: space.xl, textAlign: "center" }}>
          去“剧本”导入一张角色卡，就可以开始第一个故事。
        </Body>
        <Button label="去导入角色卡" onPress={() => router.navigate("/library")} />
      </Centered>
    );
  }
  return (
    <FlatList
      style={{ backgroundColor: palette.paper }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={data}
      keyExtractor={(pt) => pt.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={palette.muted} />
      }
      ListHeaderComponent={error ? <Notice message={describeError(error)} /> : null}
      renderItem={({ item }) => (
        <ListRow
          title={item.title}
          subtitle={subtitle(item)}
          detail={formatRelative(item.updated_at)}
          onPress={() => router.push({ pathname: "/play/[id]", params: { id: item.id } })}
          onLongPress={() => remove(item)}
        />
      )}
      ListFooterComponent={<View style={{ height: space.xxl }} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.l },
});
