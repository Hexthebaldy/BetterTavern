/**
 * 草稿里的图片（同 App 的 src/features/workbench/assets.tsx）：缩略图（带版权标记）、选封面。
 * 有版权或版权不明的图当封面前要确认“仅个人使用”（服务端没带 personal_use 时是 422 IMAGE_LICENSE）。
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import type { Asset } from "@bettertavern/core/api/types";

import { cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useBlobUrl } from "../../data/blobs.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import styles from "./chat.module.css";
import type { DraftSession } from "./useDraftSession.ts";

export function BlobImage({ blobId, alt, className }: { blobId: string; alt: string; className?: string }) {
  const image = useBlobUrl(blobId);
  return image.data ? <img src={image.data} alt={alt} className={className} loading="lazy" /> : null;
}

/** 一张图的缩略图；selected 时右上角打勾 */
export function AssetTile({
  asset,
  selected,
  onClick,
  label,
}: {
  asset: Asset;
  selected?: boolean;
  onClick?: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={cx(styles.imageTile, selected && styles.imageSelected)}
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      aria-pressed={selected}
      title={asset.prompt ?? asset.source_url ?? undefined}
    >
      <BlobImage blobId={asset.blob_id} alt="" />
      {asset.source !== "generated" && asset.source !== "upload" ? (
        <span className={styles.license}>{t(`workbench.cover.licenses.${asset.license}`)}</span>
      ) : null}
      {selected ? (
        <span className={styles.check}>
          <Icon name="check" size={13} />
        </span>
      ) : null}
    </button>
  );
}

/** 换封面、去掉封面、上传图片；成功后换上服务端返回的草稿 */
export function useCoverActions(draftId: string, session: DraftSession) {
  const { api } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const setDraft = session.setDraft;

  const pick = useCallback(
    async (asset: Asset): Promise<boolean> => {
      let personalUse = asset.personal_use;
      if ((asset.license === "copyrighted" || asset.license === "unknown") && !personalUse) {
        const ok = await overlay.confirm({
          title: t("workbench.cover.licenseTitle"),
          message: t("workbench.cover.licenseMessage"),
          confirmLabel: t("workbench.cover.licenseConfirm"),
          tone: "warn",
          icon: "image",
        });
        if (!ok) return false;
        personalUse = true;
      }
      try {
        setDraft(await api.workbench.setCover(draftId, asset.id, personalUse));
        return true;
      } catch (e) {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
        return false;
      }
    },
    [api, draftId, overlay, setDraft, t],
  );

  const remove = useCallback(async () => {
    try {
      setDraft(await api.workbench.setCover(draftId, null));
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  }, [api, draftId, overlay, setDraft, t]);

  /** 上传一张图并直接当封面（自己上传的不用确认版权） */
  const upload = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const asset = await api.workbench.uploadAsset(draftId, file);
        setDraft(await api.workbench.setCover(draftId, asset.id));
        return true;
      } catch (e) {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
        return false;
      }
    },
    [api, draftId, overlay, setDraft, t],
  );

  return { pick, remove, upload };
}

export type CoverActions = ReturnType<typeof useCoverActions>;
