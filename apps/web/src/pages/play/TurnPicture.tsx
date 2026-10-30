/**
 * 故事配图（docs/illustrations.md）阅读页上的几样（同 App 的 src/features/play/PictureParts.tsx）：
 * - TurnPicture：一回合正文下面的图。画好的那张横着铺满正文那一栏，点一下看大图，下面一行“重画”“删掉”；
 *   重画时旧图上盖一条“正在重画…”；还没有图时是一个 3:2 的网点框写“正在画…”；
 *   没画出来时一行原因，带“再试一次”“关掉”。
 * - DrawDialog：点“画这一幕”弹出的小框：想看什么（可以不填）、画风（这一局记住）、用的是哪个出图服务；
 *   没配出图服务时说明一句，带“去设置”。
 * - ImageViewer：大图，下面是发给出图服务的画面描述。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { describeTurnError } from "@bettertavern/core/api/client";
import type { DrawImage, ImageStyle, TurnError, TurnImage } from "@bettertavern/core/api/types";
import { IMAGE_STYLES, imageErrorKey, imageStyleKey, pictureOf } from "@bettertavern/core/play/illustrations";

import { Button, Chip, Dots, IconButton, Notice, TextArea } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useBlobUrl } from "../../data/blobs.ts";
import { useToolRoutes } from "../../data/tools.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import styles from "./picture.module.css";

/** 阅读页给每一回合的配图用的几个操作（要稳定，故事流里每一段都是 memo 的） */
export type PictureActions = {
  /** 打开“画这一幕”的小框；重画时带上那张图的“想看什么” */
  draw: (turnId: string, request?: string) => void;
  /** 没画出来的那条：按原来的要求再画一次 */
  retry: (image: TurnImage) => void;
  /** 删掉一张图，或者关掉一条没画出来的记录 */
  remove: (image: TurnImage) => void;
  open: (image: TurnImage) => void;
};

/** 3:2 的图（宽高不知道时按 3:2 留位置），取图片的时候先是同样大小的网点框 */
function SceneImage({ image, className }: { image: TurnImage; className?: string }) {
  const { t } = useTranslation();
  const url = useBlobUrl(image.blob_id);
  const ratio = image.width && image.height ? `${image.width} / ${image.height}` : "3 / 2";
  return url.data ? (
    <img
      src={url.data}
      alt={t("play.imageAlt")}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      className={className ?? styles.image}
      style={{ aspectRatio: ratio }}
    />
  ) : (
    <span className={styles.placeholder} style={{ aspectRatio: ratio }} aria-hidden="true" />
  );
}

export function TurnPicture({
  turnId,
  images,
  actions,
}: {
  turnId: string;
  images: TurnImage[] | undefined;
  actions: PictureActions;
}) {
  const { t } = useTranslation();
  const { shown, drawing, failed } = pictureOf(images);
  if (!shown && !drawing && !failed) return null;
  return (
    <div className={styles.picture}>
      {shown ? (
        <figure className={styles.figure}>
          <button
            type="button"
            className={styles.open}
            aria-label={t("play.imageOpen")}
            onClick={() => actions.open(shown)}
          >
            <SceneImage image={shown} />
            {drawing ? (
              <span className={styles.redrawing} role="status">
                <Dots />
                {t("play.redrawing")}
              </span>
            ) : null}
          </button>
          <figcaption className={styles.tools}>
            <button
              type="button"
              className={styles.tool}
              disabled={drawing !== null}
              onClick={() => actions.draw(turnId, shown.request)}
            >
              <Icon name="retry" size={14} strokeWidth={2.2} />
              {t("play.imageRedraw")}
            </button>
            <button type="button" className={styles.tool} onClick={() => actions.remove(shown)}>
              <Icon name="trash" size={14} strokeWidth={2.2} />
              {t("play.imageDelete")}
            </button>
          </figcaption>
        </figure>
      ) : drawing ? (
        <div className={styles.drawing} role="status">
          <span className={styles.drawingLabel}>
            <Dots />
            {t("play.drawing")}
          </span>
          <span className={styles.drawingNote}>{t("play.drawingNote")}</span>
        </div>
      ) : null}
      {failed ? (
        <p className={styles.failed} role="alert">
          <Icon name="alertCircle" size={16} />
          <span className={styles.failedText}>
            {t("play.imageFailed", { reason: t(imageErrorKey(failed.error)) })}
          </span>
          <button type="button" className={styles.link} onClick={() => actions.retry(failed)}>
            {t("play.imageRetry")}
          </button>
          <button type="button" className={styles.linkQuiet} onClick={() => actions.remove(failed)}>
            {t("play.imageDismiss")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function DrawDialog({
  initialRequest,
  initialStyle,
  onDraw,
  onOpenSettings,
  onClose,
}: {
  initialRequest: string;
  initialStyle: ImageStyle;
  /** 点下“画”：成功（服务端开始画了）返回 null，否则返回原因 */
  onDraw: (body: DrawImage) => Promise<TurnError | null>;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const routes = useToolRoutes();
  const images = (routes.data ?? []).filter((r) => r.kind === "image");
  const service = images.find((r) => r.is_default) ?? images[0];
  const [request, setRequest] = useState(initialRequest);
  const [style, setStyle] = useState<ImageStyle>(initialStyle);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const draw = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const failure = await onDraw({ request: request.trim(), style });
    setBusy(false);
    if (failure) setProblem(t("play.drawFailed", { error: describeTurnError(failure) }));
    else onClose();
  };

  return (
    <Dialog label={t("play.drawTitle")} onClose={onClose} width={520} bare>
      <div className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{t("play.drawTitle")}</h2>
          <IconButton icon="close" label={t("common.close")} tone="plain" onClick={onClose} />
        </div>
        {routes.isPending ? (
          <Dots label={t("common.loading")} />
        ) : service ? (
          <>
            <TextArea
              label={t("play.drawRequest")}
              optional
              placeholder={t("play.drawRequestPlaceholder")}
              value={request}
              maxLength={300}
              counter
              height={76}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className={styles.styleRow} role="group" aria-label={t("play.drawStyle")}>
              <span className={styles.rowLabel}>
                {t("play.drawStyle")}
                <span className={styles.rowHint}>{t("play.drawStyleHint")}</span>
              </span>
              <div className={styles.chips}>
                {IMAGE_STYLES.map((id) => (
                  <Chip
                    key={id || "none"}
                    label={t(imageStyleKey(id))}
                    selected={style === id}
                    onClick={() => setStyle(id)}
                  />
                ))}
              </div>
            </div>
            <p className={styles.service}>
              {t("play.drawUsing", { name: service.label || service.model || service.provider })}
              <br />
              {t("play.drawCost")}
            </p>
            {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
            <div className={styles.dialogFoot}>
              <Button label={t("common.cancel")} variant="secondary" onClick={onClose} />
              <Button label={t("play.drawGo")} icon="image" busy={busy} onClick={() => void draw()} />
            </div>
          </>
        ) : (
          <>
            <Notice
              tone="info"
              icon="image"
              message={
                <>
                  <strong>{t("play.drawNoService")}</strong>
                  <br />
                  {t("play.drawNoServiceHint")}
                </>
              }
            />
            <div className={styles.dialogFoot}>
              <Button label={t("common.cancel")} variant="secondary" onClick={onClose} />
              <Button label={t("play.drawGoSettings")} icon="settings" onClick={onOpenSettings} />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ImageViewer({ image, onClose }: { image: TurnImage; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog label={t("play.imageAlt")} onClose={onClose} width={1120} bare className={styles.viewerDialog}>
      <div className={styles.viewer}>
        <SceneImage image={image} className={styles.viewerImage} />
        <div className={styles.viewerFoot}>
          {image.prompt ? (
            <p className={styles.prompt}>
              <span className={styles.rowLabel}>{t("play.imagePrompt")}</span>
              {image.prompt}
            </p>
          ) : (
            <span />
          )}
          <IconButton icon="close" label={t("play.imageClose")} tone="card" onClick={onClose} />
        </div>
      </div>
    </Dialog>
  );
}
