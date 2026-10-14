/** 设置首页：导演模型、密钥、账户、连接测试 */

import { useRouter } from "expo-router";

import { CLIENT_VERSION } from "../../src/config.ts";
import { Caption, GroupLabel, ListRow, Notice, Page } from "../../src/components/ui.tsx";
import { describeError } from "../../src/api/client.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space } from "../../src/theme/index.ts";

export default function SettingsScreen() {
  const { api, user, serverUrl } = useApp();
  const router = useRouter();
  const { data, error, refreshing, reload } = useAsync(async () => {
    const [routes, credentials] = await Promise.all([api.routes.list(), api.credentials.list()]);
    return { director: routes.find((r) => r.task === "director") ?? null, credentials };
  }, [api]);

  const director = data?.director;
  return (
    <Page refreshing={refreshing} onRefresh={() => void reload()}>
      {error ? <Notice message={describeError(error)} /> : null}
      <GroupLabel>模型</GroupLabel>
      <ListRow
        title="导演模型"
        subtitle={
          director
            ? `${director.model}（${director.credential_label || director.provider}）`
            : data
              ? "还没有设置：先添加密钥，再选一个模型"
              : " "
        }
        onPress={() => router.push("/settings/routes")}
      />
      <ListRow
        title="密钥与端点"
        subtitle={
          data ? (data.credentials.length > 0 ? `已添加 ${data.credentials.length} 个` : "还没有添加") : " "
        }
        onPress={() => router.push("/settings/credentials")}
      />
      <GroupLabel>账户</GroupLabel>
      <ListRow
        title={user?.display_name || user?.email || "账户"}
        subtitle={user?.email}
        onPress={() => router.push("/settings/account")}
      />
      <GroupLabel>其他</GroupLabel>
      <ListRow
        title="连接测试"
        subtitle="检查流式输出、断线续传和延迟"
        onPress={() => router.push("/dev/probe")}
      />
      <Caption style={{ marginTop: space.xl }}>
        版本 {CLIENT_VERSION}，服务器 {serverUrl}
      </Caption>
    </Page>
  );
}
