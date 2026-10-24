/**
 * 添加模型（宽屏设置的右栏）：左栏是模型列表时，点“＋”在右栏打开这一页，内容就是模型页下面的添加表单
 * （AddModelForm）。加好以后右栏换到新模型的详情。手机、中屏的添加表单在模型页里（ModelsBody.tsx）。
 */

import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";

import { ErrorState, Loading } from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { ctype, useComic } from "../../../theme/index.ts";
import { AddModelForm } from "../AddModelForm.tsx";
import { useSettingsNav } from "../nav.tsx";

export function AddModelBody() {
  const { api } = useApp();
  const nav = useSettingsNav();
  const c = useComic();
  const { t } = useTranslation();
  const { data, error, loading, reload } = useAsync(async () => {
    const [providers, routes] = await Promise.all([api.models.providers(), api.models.list()]);
    return { providers, routes };
  }, [api]);
  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <ErrorState title={t("models.loadFailed")} message={describeError(error)} onRetry={() => void reload()} />
    );
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={[ctype.title, { fontSize: 26, lineHeight: 32, color: c.ink }]}>
            {t("models.add")}
          </Text>
        </View>
        <AddModelForm
          providers={data.providers}
          routes={data.routes}
          onAdded={(created) => nav.open({ screen: "model", id: created.id })}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
