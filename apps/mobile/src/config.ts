/**
 * 客户端配置。服务端地址默认取 EXPO_PUBLIC_API_URL（开发时写在 apps/mobile/.env 里，打包时写进 App）；
 * 发给别人装的安装包默认连线上的 https://bettertavern.com（eas.json）；用户可以在登录页底部换成自己的服务器（存在设备上）。
 * 没有设置时是空的（自己构建、没写这个变量），登录、注册前先填服务器。
 */

export const CLIENT_VERSION = "0.1.0";

export const DEFAULT_SERVER_URL = normalizeServerUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "",
);

/** 去掉首尾空白和末尾的斜杠；没写协议时补 http:// */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
