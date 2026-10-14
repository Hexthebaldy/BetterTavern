/**
 * 客户端配置。服务端地址默认取 EXPO_PUBLIC_API_URL（打包时写进 App），
 * 登录页可以改成别的地址（存在设备上），方便连局域网里的开发服务器。
 */

export const CLIENT_VERSION = "0.1.0";

export const DEFAULT_SERVER_URL = normalizeServerUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.1.10:8000",
);

/** 去掉首尾空白和末尾的斜杠；没写协议时补 http:// */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
