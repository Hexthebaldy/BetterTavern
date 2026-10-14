/** 登录、注册页底部的服务器地址设置 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useApp } from "../state/AppProvider.tsx";
import { space, usePalette } from "../theme/index.ts";
import { Button, Caption, Field } from "./ui.tsx";

export function ServerSetting() {
  const { serverUrl, setServerUrl } = useApp();
  const palette = usePalette();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(serverUrl);
  if (!editing) {
    return (
      <View style={styles.server}>
        <Caption numberOfLines={1} style={{ flex: 1 }}>
          服务器：{serverUrl}
        </Caption>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setDraft(serverUrl);
            setEditing(true);
          }}
        >
          <Caption style={{ color: palette.accent }}>更改</Caption>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ marginTop: space.xl }}>
      <Field
        label="服务器地址"
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint="例如 http://192.168.1.10:8000，或部署好的 https 地址"
      />
      <View style={styles.row}>
        <Button
          label="保存"
          style={{ flex: 1 }}
          onPress={() => {
            void setServerUrl(draft);
            setEditing(false);
          }}
        />
        <Button
          label="测试连接"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => router.push("/dev/probe")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  server: { flexDirection: "row", alignItems: "center", marginTop: space.xxl, gap: space.m },
  row: { flexDirection: "row", gap: space.m },
});
