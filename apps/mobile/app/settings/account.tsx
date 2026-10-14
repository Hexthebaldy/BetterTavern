/** 账户：退出登录、删除账户（要输入密码确认） */

import { useState } from "react";
import { Alert } from "react-native";

import { describeError } from "../../src/api/client.ts";
import { Body, Button, Caption, Field, GroupLabel, Notice, Page } from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space } from "../../src/theme/index.ts";
import { formatRelative } from "../../src/utils/format.ts";

export default function AccountScreen() {
  const { api, user, signOut } = useApp();
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = (): void => {
    Alert.alert("删除账户？", "所有故事、剧本和密钥都会被永久删除，无法恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          setError(null);
          api.auth
            .deleteAccount(password)
            .then(() => signOut())
            .catch((e: unknown) => {
              setError(describeError(e));
              setDeleting(false);
            });
        },
      },
    ]);
  };

  return (
    <Page>
      <Body>{user?.email}</Body>
      {user?.display_name ? <Caption style={{ marginTop: space.xs }}>{user.display_name}</Caption> : null}
      {user?.created_at ? (
        <Caption style={{ marginTop: space.xs }}>注册于 {formatRelative(user.created_at)}</Caption>
      ) : null}
      <Button
        label="退出登录"
        variant="secondary"
        onPress={() => void signOut()}
        style={{ marginTop: space.xl }}
      />

      <GroupLabel>删除账户</GroupLabel>
      {error ? <Notice message={error} /> : null}
      <Field
        label="输入密码确认"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <Button
        label="删除账户"
        variant="danger"
        onPress={confirmDelete}
        busy={deleting}
        disabled={!password}
      />
    </Page>
  );
}
