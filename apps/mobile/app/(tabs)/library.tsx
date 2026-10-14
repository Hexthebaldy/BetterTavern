/**
 * 剧本库：导入角色卡（PNG 或 JSON，原样上传，服务端解析），列出已导入的剧本。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { Scenario } from "../../src/api/types.ts";
import { Avatar } from "../../src/components/Avatar.tsx";
import { Body, Button, Centered, ListRow, Loading, Notice } from "../../src/components/ui.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

const MAX_BYTES = 16 * 1024 * 1024;

function summary(s: Scenario): string {
  return s.description_preview || s.first_mes_preview || (s.creator ? `作者：${s.creator}` : "");
}

export default function LibraryScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, refreshing, reload } = useAsync(() => api.scenarios.list(), [api]);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; message: string } | null>(null);

  const importCard = async (): Promise<void> => {
    setNotice(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (!file) return;
    if (!/\.(png|json)$/i.test(file.name)) {
      setNotice({ tone: "error", message: "请选择 PNG 或 JSON 格式的角色卡" });
      return;
    }
    if (file.size !== undefined && file.size > MAX_BYTES) {
      setNotice({ tone: "error", message: "文件超过 16 MB" });
      return;
    }
    setImporting(true);
    try {
      const scenario = await api.scenarios.importFile(new File(file.uri));
      void reload();
      if (scenario.duplicate) setNotice({ tone: "info", message: `“${scenario.name}”之前已经导入过了` });
      router.push({ pathname: "/scenario/[id]", params: { id: scenario.id } });
    } catch (e) {
      setNotice({ tone: "error", message: describeError(e) });
    } finally {
      setImporting(false);
    }
  };

  if (loading && !data) return <Loading />;

  const header = (
    <View style={styles.header}>
      <Button label="导入角色卡" onPress={() => void importCard()} busy={importing} />
      {notice ? (
        <Notice tone={notice.tone} message={notice.message} style={{ marginTop: space.l, marginBottom: 0 }} />
      ) : null}
      {error && data ? (
        <Notice message={describeError(error)} style={{ marginTop: space.l, marginBottom: 0 }} />
      ) : null}
    </View>
  );

  if (!data) {
    return (
      <Centered>
        <Body style={{ marginBottom: space.l, textAlign: "center" }}>{describeError(error)}</Body>
        <Button label="重新加载" onPress={() => void reload()} />
      </Centered>
    );
  }
  return (
    <FlatList
      style={{ backgroundColor: palette.paper }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={data}
      keyExtractor={(s) => s.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={palette.muted} />
      }
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Body style={{ color: palette.muted, marginTop: space.xl }}>
          支持 SillyTavern 的角色卡（V1、V2、V3，PNG 或 JSON）。卡里附带的世界书会转成故事的世界状态。
        </Body>
      }
      renderItem={({ item }) => (
        <ListRow
          title={item.name}
          subtitle={summary(item)}
          accessory={<Avatar blobId={item.avatar_blob_id} name={item.name} />}
          onPress={() => router.push({ pathname: "/scenario/[id]", params: { id: item.id } })}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.l, paddingBottom: space.xxl },
  header: { paddingTop: space.l, paddingBottom: space.m },
});
