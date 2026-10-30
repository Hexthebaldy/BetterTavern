/**
 * 故事配图（docs/illustrations.md）的纯逻辑：一回合的几张图怎么显示、新的一张来了以后怎么换。
 *
 * 和服务端的规则一样：新的一张画好时，同一回合别的（旧图、没画出来的记录）都不要了，
 * 只剩它和还在画的；一回合同时只画一张。界面上：
 * - shown：画好的那张（重画时旧图还在，直到新的一张画好）；
 * - drawing：正在画的那一条，显示“正在画…”；
 * - failed：最近一次没画出来，而且比画好的那张新（重画失败时旧图照样显示，下面多一行原因）。
 */

import type { ImageStyle, TurnImage } from "../api/types.ts";

/** 画风的顺序（画这一幕的小框里一排）；空串是不指定 */
export const IMAGE_STYLES: readonly ImageStyle[] = ["", "anime", "realistic", "ink", "oil", "film", "flat"];

/** 客户端按服务端返回的这些原因翻译（play.imageErrors.*）；不认识的当作出图服务出错（service） */
const KNOWN_ERRORS = [
  "route_missing",
  "model_failed",
  "tool_missing",
  "storage_full",
  "timeout",
  "auth",
  "quota",
  "blocked",
  "network",
] as const;
type ImageErrorName = (typeof KNOWN_ERRORS)[number] | "service";

function knownError(error: string | null): error is (typeof KNOWN_ERRORS)[number] {
  return (KNOWN_ERRORS as readonly (string | null)[]).includes(error);
}

export type TurnPicture = {
  shown: TurnImage | null;
  drawing: TurnImage | null;
  failed: TurnImage | null;
};

export const NO_PICTURE: TurnPicture = { shown: null, drawing: null, failed: null };

function newer(a: TurnImage, b: TurnImage): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);
}

function latest(images: readonly TurnImage[], status: TurnImage["status"]): TurnImage | null {
  let found: TurnImage | null = null;
  for (const image of images) {
    if (image.status === status && (found === null || newer(image, found))) found = image;
  }
  return found;
}

export function pictureOf(images: readonly TurnImage[] | undefined): TurnPicture {
  if (!images || images.length === 0) return NO_PICTURE;
  const shown = latest(images, "ready");
  const drawing = latest(images, "pending");
  const failed = latest(images, "failed");
  return {
    shown,
    drawing,
    failed: failed && (shown === null || newer(failed, shown)) && drawing === null ? failed : null,
  };
}

/** 收到一张图（刚点下去的、查到的最新状态）以后这一回合的图 */
export function withImage(images: readonly TurnImage[] | undefined, image: TurnImage): TurnImage[] {
  const others = (images ?? []).filter((i) => i.id !== image.id);
  if (image.status === "ready") return [...others.filter((i) => i.status === "pending"), image];
  // 再点一次“画这一幕”：服务端先去掉了以前没画出来的记录
  const kept = image.status === "pending" ? others.filter((i) => i.status !== "failed") : others;
  return [...kept, image];
}

export function withoutImage(images: readonly TurnImage[] | undefined, imageId: string): TurnImage[] {
  return (images ?? []).filter((i) => i.id !== imageId);
}

/** 还在画的几张（要隔几秒查一次） */
export function drawingImages(byTurn: Readonly<Record<string, readonly TurnImage[]>>): TurnImage[] {
  return Object.values(byTurn).flatMap((images) => images.filter((i) => i.status === "pending"));
}

/** 回合列表里带的图，按回合分好 */
export function imagesByTurn(
  turns: readonly { id: string; images?: TurnImage[] }[],
): Record<string, TurnImage[]> {
  const found: Record<string, TurnImage[]> = {};
  for (const turn of turns) {
    if (turn.images && turn.images.length > 0) found[turn.id] = [...turn.images];
  }
  return found;
}

/** 画风的界面文字的键（play.imageStyles.*）；不指定是 none */
export function imageStyleKey(style: ImageStyle): `play.imageStyles.${Exclude<ImageStyle, ""> | "none"}` {
  return `play.imageStyles.${style || "none"}`;
}

/** 没画出来的原因对应的界面文字的键（play.imageErrors.*） */
export function imageErrorKey(error: string | null): `play.imageErrors.${ImageErrorName}` {
  return `play.imageErrors.${knownError(error) ? error : "service"}`;
}
