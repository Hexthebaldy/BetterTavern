/**
 * 故事配图（docs/illustrations.md）阅读页上的几样（同网页端 pages/play/TurnPicture.tsx）：
 * - TurnPicture：一回合正文下面的图。画好的那张横着铺满正文那一栏，点一下看大图，下面一行“重画”“删掉”；
 *   重画时旧图上盖一条“正在重画…”；还没有图时是一个 3:2 的网点框写“正在画…”；
 *   没画出来时一行原因，带“再试一次”“关掉”。还没有图时只有靠右一行“画这一幕”。
 * - DrawSheet：点“画这一幕”弹出的面板：想看什么（可以不填）、画风（这一局记住）、用的是哪个出图服务；
 *   没配出图服务时说明一句，带“去设置”。
 * - ImageSheet：大图，下面是发给出图服务的画面描述。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError, describeTurnError } from "@bettertavern/core/api/client";
import type { DrawImage, ImageStyle, ToolRoute, TurnError, TurnImage } from "@bettertavern/core/api/types";
import { IMAGE_STYLES, imageErrorKey, imageStyleKey, pictureOf } from "@bettertavern/core/play/illustrations";

import { Halftone } from "../../components/Halftone.tsx";
import { Button, Chip, Dots, Field, Icon, Notice, Sheet } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { comicDepth, comicRadius, comicStroke, hardShadow, space, useComic } from "../../theme/index.ts";
import { READ_SIDE } from "./FeedParts.tsx";

/** 阅读页给每一回合的配图用的几个操作（要稳定，故事流里每一段都是 memo 的） */
export type PictureActions = {
  /** 打开“画这一幕”的面板；重画时带上那张图的“想看什么” */
  draw: (turnId: string, request?: string) => void;
  /** 没画出来的那条：按原来的要求再画一次 */
  retry: (image: TurnImage) => void;
  /** 删掉一张图，或者关掉一条没画出来的记录 */
  remove: (image: TurnImage) => void;
  open: (image: TurnImage) => void;
};

/** 带登录凭据取的图；宽高比按图的宽高，不知道时 3:2 */
function SceneImage({ image, rounded }: { image: TurnImage; rounded: number }) {
  const c = useComic();
  const { api, authHeaders, serverUrl } = useApp();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    void authHeaders().then(
      (h) => alive && setHeaders(h),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [authHeaders]);
  const ratio = image.width && image.height ? image.width / image.height : 3 / 2;
  if (!headers || !image.blob_id) {
    return <Halftone tone="ink" style={{ width: "100%", aspectRatio: ratio, borderRadius: rounded }} />;
  }
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: `${serverUrl}${api.blobPath(image.blob_id)}`, headers }}
      style={{ width: "100%", aspectRatio: ratio, borderRadius: rounded, backgroundColor: c.grey2 }}
      resizeMode="contain"
    />
  );
}

function TextButton({
  label,
  icon,
  color,
  disabled,
  onPress,
}: {
  label: string;
  icon?: "retry" | "trash" | "image";
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 }]}
    >
      {icon ? <Icon name={icon} size={15} color={color} /> : null}
      <Text style={[styles.textButtonLabel, { color }]}>{label}</Text>
    </Pressable>
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
  const c = useComic();
  const { t } = useTranslation();
  const { shown, drawing, failed } = pictureOf(images);
  return (
    <View style={styles.picture}>
      {shown ? (
        <View style={{ gap: space.s }}>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={t("play.imageOpen")}
            onPress={() => actions.open(shown)}
            style={[
              styles.frame,
              {
                borderColor: c.ink,
                backgroundColor: c.paper,
                boxShadow: hardShadow(c.ink, comicDepth.focus),
              },
            ]}
          >
            {/* 圆角裁图放在里面一层：外层要画投影，不能裁 */}
            <View style={styles.clip}>
              <SceneImage image={shown} rounded={comicRadius.frame - comicStroke.frame} />
            </View>
            {drawing ? (
              <View style={[styles.redrawing, { backgroundColor: c.ink }]} accessibilityRole="progressbar">
                <Dots color={c.paper} cell={4} gap={3} />
                <Text style={[styles.redrawingText, { color: c.paper }]}>{t("play.redrawing")}</Text>
              </View>
            ) : null}
          </Pressable>
          <View style={styles.tools}>
            <TextButton
              label={t("play.imageRedraw")}
              icon="retry"
              color={c.mut}
              disabled={drawing !== null}
              onPress={() => actions.draw(turnId, shown.request)}
            />
            <TextButton
              label={t("play.imageDelete")}
              icon="trash"
              color={c.mut}
              onPress={() => actions.remove(shown)}
            />
          </View>
        </View>
      ) : drawing ? (
        <View accessibilityRole="progressbar" accessibilityLabel={t("play.drawing")}>
          <Halftone tone="ink" style={[styles.drawing, { borderColor: c.ink }]}>
            <View style={[styles.drawingLabel, { backgroundColor: c.paper }]}>
              <Dots cell={5} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: c.ink }}>{t("play.drawing")}</Text>
            </View>
            <Text style={[styles.drawingNote, { color: c.mut, backgroundColor: c.paper }]}>
              {t("play.drawingNote")}
            </Text>
          </Halftone>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.failed} accessibilityRole="alert">
          <Icon name="alertCircle" size={16} color={c.err} />
          <Text style={[styles.failedText, { color: c.ink2 }]}>
            {t("play.imageFailed", { reason: t(imageErrorKey(failed.error)) })}
          </Text>
          <TextButton label={t("play.imageRetry")} color={c.acc} onPress={() => actions.retry(failed)} />
          <TextButton label={t("play.imageDismiss")} color={c.mut} onPress={() => actions.remove(failed)} />
        </View>
      ) : null}
      {/* 还没有图时才有“画这一幕”：有图时用图下面的“重画”，没画出来时用“再试一次” */}
      {!shown && !drawing && !failed ? (
        <View style={styles.tools}>
          <TextButton
            label={t("play.drawScene")}
            icon="image"
            color={c.mut}
            onPress={() => actions.draw(turnId)}
          />
        </View>
      ) : null}
    </View>
  );
}

export function DrawSheet({
  visible,
  initialRequest,
  initialStyle,
  onDraw,
  onOpenSettings,
  onClose,
}: {
  visible: boolean;
  initialRequest: string;
  initialStyle: ImageStyle;
  /** 点下“画”：成功（服务端开始画了）返回 null，否则返回原因 */
  onDraw: (body: DrawImage) => Promise<TurnError | null>;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const { api } = useApp();
  // 每次打开都重新读一次出图服务（可能刚去设置里加了一个）；读回来之前显示加载中，不先说“还没配”
  const [routes, setRoutes] = useState<ToolRoute[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRoutes(null);
    setLoadError(null);
    api.tools.list().then(
      (found) => alive && setRoutes(found),
      (e: unknown) => alive && setLoadError(e),
    );
    return () => {
      alive = false;
    };
  }, [api, visible]);
  const images = (routes ?? []).filter((r) => r.kind === "image");
  const service = images.find((r) => r.is_default) ?? images[0];
  const [request, setRequest] = useState(initialRequest);
  const [style, setStyle] = useState<ImageStyle>(initialStyle);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 每次打开都从这一回合的要求和这一局的画风开始
  useEffect(() => {
    if (!visible) return;
    setRequest(initialRequest);
    setStyle(initialStyle);
    setProblem(null);
  }, [visible, initialRequest, initialStyle]);

  const draw = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const failure = await onDraw({ request: request.trim(), style });
    setBusy(false);
    if (failure) setProblem(t("play.drawFailed", { error: describeTurnError(failure) }));
    else onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("play.drawTitle")}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        {loadError ? (
          <Notice message={describeError(loadError)} />
        ) : routes === null ? (
          <Dots />
        ) : service ? (
          <>
            <Field
              label={t("play.drawRequest")}
              optional
              placeholder={t("play.drawRequestPlaceholder")}
              multiline
              boxHeight={76}
              value={request}
              maxLength={300}
              onChangeText={setRequest}
            />
            <View style={{ gap: space.s }}>
              <Text style={[styles.label, { color: c.ink }]}>
                {t("play.drawStyle")}
                <Text style={{ fontWeight: "400", color: c.mut }}>{`  ${t("play.drawStyleHint")}`}</Text>
              </Text>
              <View style={styles.chips}>
                {IMAGE_STYLES.map((id) => (
                  <Chip
                    key={id || "none"}
                    small
                    label={t(imageStyleKey(id))}
                    selected={style === id}
                    onPress={() => setStyle(id)}
                  />
                ))}
              </View>
            </View>
            <Text style={[styles.service, { color: c.mut }]}>
              {`${t("play.drawUsing", { name: service.label || service.model || service.provider })}\n${t("play.drawCost")}`}
            </Text>
            {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
            <Button label={t("play.drawGo")} icon="image" busy={busy} onPress={() => void draw()} />
          </>
        ) : (
          <>
            <Notice
              tone="info"
              icon="image"
              title={t("play.drawNoService")}
              message={t("play.drawNoServiceHint")}
            />
            <Button label={t("play.drawGoSettings")} icon="settings" onPress={onOpenSettings} />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

export function ImageSheet({ image, onClose }: { image: TurnImage | null; onClose: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Sheet visible={image !== null} onClose={onClose} full title={t("play.imageAlt")}>
      <ScrollView contentContainerStyle={styles.sheet}>
        {image ? (
          <>
            <View style={[styles.frame, styles.clip, { borderColor: c.ink, backgroundColor: c.paper }]}>
              <SceneImage image={image} rounded={comicRadius.frame - comicStroke.frame} />
            </View>
            {image.prompt ? (
              <View style={{ gap: space.xs }}>
                <Text style={[styles.label, { color: c.ink }]}>{t("play.imagePrompt")}</Text>
                <Text selectable style={{ fontSize: 13, lineHeight: 20, color: c.mut }}>
                  {image.prompt}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  picture: { paddingHorizontal: READ_SIDE, gap: space.s },
  frame: { borderWidth: comicStroke.frame, borderRadius: comicRadius.frame },
  clip: { overflow: "hidden", borderRadius: comicRadius.frame - comicStroke.frame },
  redrawing: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  redrawingText: { fontSize: 12.5, fontWeight: "700" },
  tools: { flexDirection: "row", justifyContent: "flex-end", gap: space.l },
  textButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
  textButtonLabel: { fontSize: 13, fontWeight: "600" },
  drawing: {
    width: "100%",
    aspectRatio: 3 / 2,
    borderWidth: comicStroke.control,
    borderStyle: "dashed",
    borderRadius: comicRadius.frame,
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
    padding: space.l,
  },
  drawingLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  drawingNote: { fontSize: 12.5, textAlign: "center", paddingHorizontal: 6 },
  failed: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4 },
  failedText: { fontSize: 13, flexShrink: 1 },
  sheet: { paddingHorizontal: space.l, paddingBottom: 40, gap: space.l },
  label: { fontSize: 13.5, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  service: { fontSize: 12.5, lineHeight: 19 },
});
