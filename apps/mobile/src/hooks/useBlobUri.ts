/**
 * 要登录才能取的图（/v1/blobs/{id}：卡封面、人设头像、故事配图）：先带着登录凭据下载到缓存目录，
 * 再把本地文件交给 <Image> 显示。
 *
 * 不把凭据放进 <Image source={{ headers }}>：安卓上（Expo Go 的图片管线）这些请求头会被丢掉，
 * 服务端回 401，图一直是空的（2026-10-30 在 Pixel 4 模拟器上实测）；iOS 上虽然带得上，两边走同一条路。
 *
 * - 图片 ID 对应的内容不会变：缓存文件按“服务器 + 图片 ID”命名，下载过一次就不再下载，
 *   已经下载过的打开页面时直接显示，不闪占位；
 * - 同一张图同时被几处要时只下载一次；
 * - 先下载到 .part 文件，下完再改名：安卓上下到一半出错时不会留下半张图。
 * 缓存放在系统的缓存目录，空间不够时系统会清掉，清掉了就重新下载。
 */

import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

import { useApp } from "../state/AppProvider.tsx";

const inflight = new Map<string, Promise<string>>();

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, "blobs");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** 缓存文件名：服务器地址只留字母和数字（不同服务器的图分开放），后面是图片 ID */
function fileName(serverUrl: string, blobId: string): string {
  const server = serverUrl.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${server}-${blobId.replace(/[^A-Za-z0-9-]/g, "")}`;
}

function cached(name: string): string | null {
  try {
    const file = new File(cacheDir(), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

async function download(url: string, name: string, headers: Record<string, string>): Promise<string> {
  const dir = cacheDir();
  const target = new File(dir, name);
  if (target.exists) return target.uri;
  const part = new File(dir, `${name}.part`);
  try {
    await File.downloadFileAsync(url, part, { headers, idempotent: true });
    part.rename(name);
    return new File(dir, name).uri;
  } catch (error) {
    if (part.exists) part.delete();
    throw error;
  }
}

/** 一张要登录才能取的图在本机的地址：还在下载时 uri 是 null；下载失败（没有这张图、没登录、连不上）时 failed */
export function useBlobUri(blobId: string | null | undefined): { uri: string | null; failed: boolean } {
  const { api, authHeaders, serverUrl } = useApp();
  const name = blobId ? fileName(serverUrl, blobId) : null;
  const [state, setState] = useState<{ name: string | null; uri: string | null; failed: boolean }>(() => ({
    name,
    uri: name ? cached(name) : null,
    failed: false,
  }));

  useEffect(() => {
    if (!blobId || !name) return;
    const hit = cached(name);
    if (hit) {
      setState({ name, uri: hit, failed: false });
      return;
    }
    let alive = true;
    setState({ name, uri: null, failed: false });
    let job = inflight.get(name);
    if (!job) {
      job = authHeaders()
        .then((headers) => download(`${serverUrl}${api.blobPath(blobId)}`, name, headers))
        .finally(() => inflight.delete(name));
      inflight.set(name, job);
    }
    job.then(
      (uri) => alive && setState({ name, uri, failed: false }),
      () => alive && setState({ name, uri: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [blobId, name, serverUrl, api, authHeaders]);

  // 换了一张图、还没轮到 effect 时，不显示上一张
  if (state.name !== name) return { uri: name ? cached(name) : null, failed: false };
  return { uri: state.uri, failed: state.failed };
}
