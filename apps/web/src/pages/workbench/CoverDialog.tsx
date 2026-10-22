/**
 * 封面面板（同 App 的 src/features/workbench/CoverSheet.tsx）：现在的封面，上传、去掉；
 * 用设置里“外部服务”的文生图直接出几张（不经过 agent，画面描述、风格、张数）；草稿里的图点一下当封面。
 * 没有配置文生图时说明可以上传或者去设置里加。
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import type { Draft } from "@bettertavern/core/api/types";

import { Button, Chip, IconButton, Notice, TextArea } from "../../components/controls.tsx";
import { useToolRoutes } from "../../data/tools.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { AssetTile, BlobImage, type CoverActions } from "./assets.tsx";
import chat from "./chat.module.css";
import styles from "./preview.module.css";

const STYLES = ["none", "ink", "oil", "film", "flat"] as const;
const COUNTS = [1, 2, 3, 4] as const;

export function CoverDialog({
  draft,
  cover,
  onGenerated,
  onClose,
}: {
  draft: Draft;
  cover: CoverActions;
  /** 生成完了：重新读草稿（新图在草稿的图片里） */
  onGenerated: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const routes = useToolRoutes();
  const imageRoutes = (routes.data ?? []).filter((r) => r.kind === "image");
  const service = imageRoutes.find((r) => r.is_default) ?? imageRoutes[0];
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("none");
  const [count, setCount] = useState<number>(2);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
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

  const upload = async (picked: File | undefined): Promise<void> => {
    if (!picked) return;
    setUploading(true);
    try {
      await cover.upload(picked);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <Dialog label={t("workbench.cover.title")} onClose={onClose} width={560} bare>
      <div className={styles.coverDialog}>
        <div className={styles.coverDialogHead}>
          <h2 className={styles.coverDialogTitle}>{t("workbench.cover.title")}</h2>
          <IconButton icon="close" label={t("common.close")} tone="plain" onClick={onClose} />
        </div>
        <div className={styles.coverCurrent}>
          {current ? (
            <BlobImage blobId={current} alt={t("workbench.cover.selected")} className={styles.coverCurrentImg} />
          ) : (
            <span className={styles.coverCurrentImg} />
          )}
          <div className={styles.coverCurrentBody}>
            <span>{current ? t("workbench.cover.selected") : t("workbench.cover.none")}</span>
            <div className={styles.row}>
              <Button
                label={uploading ? t("workbench.cover.uploading") : t("workbench.cover.upload")}
                icon="import"
                variant="secondary"
                size="sm"
                busy={uploading}
                onClick={() => file.current?.click()}
              />
              {current ? (
                <Button label={t("workbench.cover.remove")} variant="text" size="sm" onClick={() => void cover.remove()} />
              ) : null}
            </div>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={styles.fileInput}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className={styles.generate}>
          {service ? (
            <>
              <TextArea
                label={t("workbench.cover.prompt")}
                placeholder={t("workbench.cover.promptPlaceholder")}
                value={prompt}
                maxLength={1000}
                height={84}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t("workbench.cover.style")}</span>
                {STYLES.map((id) => (
                  <Chip
                    key={id}
                    label={t(`workbench.cover.styles.${id}`)}
                    selected={style === id}
                    onClick={() => setStyle(id)}
                  />
                ))}
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t("workbench.cover.count")}</span>
                {COUNTS.map((n) => (
                  <Chip key={n} label={String(n)} selected={count === n} onClick={() => setCount(n)} />
                ))}
              </div>
              {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
              <div className={styles.row}>
                <Button
                  label={generating ? t("workbench.cover.generating") : t("workbench.cover.generate")}
                  icon="image"
                  busy={generating}
                  disabled={!prompt.trim()}
                  onClick={() => void generate()}
                />
                <span className={styles.service}>
                  {t("workbench.cover.using", { service: service.label || service.provider })}
                </span>
              </div>
            </>
          ) : routes.isPending ? null : (
            <span className={styles.service}>{t("workbench.cover.noService")}</span>
          )}
        </div>

        {draft.assets.length ? (
          <div className={chat.images}>
            {draft.assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                selected={draft.cover_asset_id === asset.id}
                label={t("workbench.messages.useAsCover")}
                onClick={() => void cover.pick(asset)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
