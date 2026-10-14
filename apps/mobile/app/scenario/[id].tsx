/**
 * 剧本详情：预览角色卡，填主角和偏好，开始一个新故事。
 * 开始后服务端先根据角色卡搭建世界、再写开场，阅读页会接上这个过程的事件流。
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";

import { ApiError, describeError } from "../../src/api/client.ts";
import type { Preferences } from "../../src/api/types.ts";
import { Avatar } from "../../src/components/Avatar.tsx";
import {
  Body,
  Button,
  Caption,
  Centered,
  Field,
  GroupLabel,
  Heading,
  Loading,
  Notice,
  Page,
  Rule,
  Segmented,
  Title,
} from "../../src/components/ui.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

const LENGTHS: { value: Preferences["length"]; label: string }[] = [
  { value: "short", label: "短" },
  { value: "medium", label: "适中" },
  { value: "long", label: "长" },
];

export default function ScenarioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const headerHeight = useHeaderHeight();
  const { data: scenario, error, loading, reload } = useAsync(() => api.scenarios.get(id), [api, id]);

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [length, setLength] = useState<Preferences["length"]>("medium");
  const [style, setStyle] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ApiError | Error | null>(null);

  if (loading && !scenario) return <Loading />;
  if (!scenario) {
    return (
      <Centered>
        <Body style={{ marginBottom: space.l, textAlign: "center" }}>{describeError(error)}</Body>
        <Button label="重新加载" onPress={() => void reload()} />
      </Centered>
    );
  }

  const start = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const created = await api.playthroughs.create({
        scenario_id: scenario.id,
        protagonist: { name: name.trim(), summary: summary.trim() },
        preferences: { length, style: style.trim(), boundaries: boundaries.trim() },
      });
      router.replace({ pathname: "/play/[id]", params: { id: created.playthrough.id } });
    } catch (e) {
      setStartError(e instanceof Error ? e : new Error(describeError(e)));
      setStarting(false);
    }
  };

  const remove = (): void => {
    Alert.alert(`删除剧本“${scenario.name}”？`, "已经开始的故事不受影响。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          api.scenarios
            .remove(scenario.id)
            .then(() => router.back())
            .catch((e: unknown) => Alert.alert("删除失败", describeError(e)));
        },
      },
    ]);
  };

  const routeMissing = startError instanceof ApiError && startError.code === "ROUTE_MISSING";
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: scenario.name }} />
      <Page>
        <View style={styles.top}>
          <Avatar blobId={scenario.avatar_blob_id} name={scenario.name} size={72} />
          <View style={{ flex: 1 }}>
            <Title numberOfLines={2}>{scenario.name}</Title>
            {scenario.creator ? <Caption>作者：{scenario.creator}</Caption> : null}
            {scenario.tags.length > 0 ? (
              <Caption numberOfLines={1}>{scenario.tags.join("、")}</Caption>
            ) : null}
          </View>
        </View>
        {scenario.description_preview ? (
          <Body style={styles.preview} selectable>
            {scenario.description_preview}
          </Body>
        ) : null}
        {scenario.first_mes_preview ? (
          <>
            <GroupLabel>原卡的开场白</GroupLabel>
            <Body style={[styles.preview, { color: palette.muted }]} selectable>
              {scenario.first_mes_preview}
            </Body>
          </>
        ) : null}
        {scenario.book_entries > 0 ? (
          <Caption style={{ marginTop: space.s }}>
            附带世界书 {scenario.book_entries} 条，开始时会整理进世界状态。
          </Caption>
        ) : null}
        {scenario.truncated_fields.length > 0 ? (
          <Caption style={{ marginTop: space.s }}>
            卡里有些内容太长，已截断：{scenario.truncated_fields.join("、")}
          </Caption>
        ) : null}

        <Rule />
        <Heading style={{ marginBottom: space.l }}>开始新的故事</Heading>
        {startError ? (
          <Notice
            message={describeError(startError)}
            actionLabel={routeMissing ? "去设置" : undefined}
            onAction={routeMissing ? () => router.push("/settings/routes") : undefined}
          />
        ) : null}
        <Field
          label="你扮演的角色叫什么"
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="例如：林川"
        />
        <Field
          label="这个角色是谁（可选）"
          value={summary}
          onChangeText={setSummary}
          maxLength={400}
          multiline
          placeholder="身份、来历、和卡里角色的关系"
        />
        <Segmented label="每段的长度" value={length} options={LENGTHS} onChange={setLength} />
        <Field
          label="文风（可选）"
          value={style}
          onChangeText={setStyle}
          maxLength={200}
          placeholder="例如：冷峻克制，多写环境"
        />
        <Field
          label="不想看到的内容（可选）"
          value={boundaries}
          onChangeText={setBoundaries}
          maxLength={300}
          placeholder="例如：不写血腥场面"
        />
        <Button label="开始故事" onPress={() => void start()} busy={starting} disabled={!name.trim()} />
        <Button label="删除剧本" variant="danger" onPress={remove} style={{ marginTop: space.xxl }} />
      </Page>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", gap: space.l, alignItems: "center", marginBottom: space.l },
  preview: { marginTop: space.s },
});
