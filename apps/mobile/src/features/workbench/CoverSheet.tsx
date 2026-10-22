/**
 * 封面面板（同网页端 pages/workbench/CoverDialog.tsx）：现在的封面，上传、去掉；
 * 用设置里“外部服务”的文生图直接出几张（不经过 agent，画面描述、风格、张数）；草稿里的图点一下当封面。
 * 没有配置文生图时说明可以上传或者去设置里加。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { Draft } from "@bettertavern/core/api/types";

import { Button, Chip, Field, Notice, Sheet } from "../../components/ui.tsx";
import { useAsync } from "../../hooks/useAsync.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { space, usePalette } from "../../theme/index.ts";
import { AssetTile, BlobImage, type CoverActions } from "./assets.tsx";

const STYLES = ["none", "ink", "oil", "film", "flat"] as const;
const COUNTS = [1, 2, 3, 4] as const;

export function CoverSheet({
  visible,
  draft,
  cover,
  onGenerated,
  onClose,
}: {
  visible: boolean;
  draft: Draft;
  cover: CoverActions;
  onGenerated: () => Promise<void>;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const { api } = useApp();
  const routes = useAsync(() => api.tools.list(), [api]);
  const imageRoutes = (routes.data ?? []).filter((r) => r.kind === "image");
  const service = imageRoutes.find((r) => r.is_default) ?? imageRoutes[0];
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("none");
  const [count, setCount] = useState<number>(2);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = draft.draft.cover_blob_id;

  const generate = async (): Promise<void> => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setProblem(null);
    try {
      await api.workbench.generateCovers(draft.draft.id, {
        prompt: prompt.trim(),
        style: style === "none" ? undefined : style,
        count,
        aspect: "portrait",
      });
      await onGenerated();
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setGenerating(false);
    }
  };

  const upload = async (): Promise<void> => {
    setUploading(true);
    try {
      await cover.upload();
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} full title={t("workbench.cover.title")}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.current}>
          {current ? (
            <BlobImage blobId={current} style={[styles.thumb, { backgroundColor: palette.bg2 }]} />
          ) : (
            <View style={[styles.thumb, { backgroundColor: palette.bg2 }]} />
          )}
          <View style={{ flex: 1, gap: space.s }}>
            <Text style={{ fontSize: 13, color: palette.mut }}>
              {current ? t("workbench.cover.selected") : t("workbench.cover.none")}
            </Text>
            <Button
              label={uploading ? t("workbench.cover.uploading") : t("workbench.cover.upload")}
              icon="import"
              variant="secondary"
              busy={uploading}
              onPress={() => void upload()}
              style={{ minHeight: 40, height: 40, alignSelf: "flex-start" }}
            />
            {current ? (
              <Button
                label={t("workbench.cover.remove")}
                variant="text"
                onPress={() => void cover.remove()}
                style={{ minHeight: 36, height: 36, alignSelf: "flex-start" }}
              />
            ) : null}
          </View>
        </View>

        <View style={[styles.generate, { backgroundColor: palette.bg2 }]}>
          {service ? (
            <>
              <Field
                label={t("workbench.cover.prompt")}
                placeholder={t("workbench.cover.promptPlaceholder")}
                multiline
                boxHeight={84}
                onGrey
                value={prompt}
                maxLength={1000}
                onChangeText={setPrompt}
              />
              <Text style={[styles.label, { color: palette.mut }]}>{t("workbench.cover.style")}</Text>
              <View style={styles.row}>
                {STYLES.map((id) => (
                  <Chip
                    key={id}
                    small
                    onGrey
                    label={t(`workbench.cover.styles.${id}`)}
                    selected={style === id}
                    onPress={() => setStyle(id)}
                  />
                ))}
              </View>
              <Text style={[styles.label, { color: palette.mut }]}>{t("workbench.cover.count")}</Text>
              <View style={styles.row}>
                {COUNTS.map((n) => (
                  <Chip key={n} small onGrey label={String(n)} selected={count === n} onPress={() => setCount(n)} />
                ))}
              </View>
              {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
              <Button
                label={generating ? t("workbench.cover.generating") : t("workbench.cover.generate")}
                icon="image"
                busy={generating}
                disabled={!prompt.trim()}
                onPress={() => void generate()}
              />
              <Text style={{ fontSize: 12, color: palette.mut }}>
                {t("workbench.cover.using", { service: service.label || service.provider })}
              </Text>
            </>
          ) : routes.loading ? null : (
            <Text style={{ fontSize: 13, lineHeight: 20, color: palette.mut }}>{t("workbench.cover.noService")}</Text>
          )}
        </View>

        {draft.assets.length ? (
          <View style={styles.row}>
            {draft.assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                width={96}
                selected={draft.cover_asset_id === asset.id}
                label={t("workbench.messages.useAsCover")}
                onPress={() => void cover.pick(asset)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.l, paddingBottom: 48, gap: space.l },
  current: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  thumb: { width: 96, height: 144, borderRadius: 14 },
  generate: { padding: 14, borderRadius: 18, gap: 10 },
  label: { fontSize: 12.5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
