/** 仓库里的链接：文件用 blob/HEAD/…，跟着默认分支走 */

import { siteRoot, type Lang } from "../i18n/langs.ts";

export const REPO = "https://github.com/Hexthebaldy/BetterTavern";
export const ISSUES = `${REPO}/issues`;

const file = (path: string) => `${REPO}/blob/HEAD/${path}`;

export const DOCS = {
  development: file("docs/development.md"),
  overview: file("docs/README.md"),
  uiDesign: file("docs/design/ui/README.md"),
  client: file("docs/client.md"),
  mobile: file("apps/mobile/README.md"),
  nginx: file("deploy/nginx.example.conf"),
};

/** 官方部署的网页版：打开就能注册使用（Android 安装包也默认连它） */
export const WEB_APP = "https://bettertavern.com";

/** Android 安装包在站点里的位置 */
export const ANDROID_APK_PATH = "downloads/BetterTavern.apk";

/**
 * Android 安装包和落地页放在同一台服务器上，点了直接下载，不跳到别的网站。安装包不进仓库，部署时另外上传
 * （apps/mobile/README.md 的“打包 Android 安装包”）。页面用相对地址，所以按这一页的语言（目录深度）算
 */
export function androidApkHref(lang: Lang): string {
  return siteRoot(lang) + ANDROID_APK_PATH;
}

/** 新窗口打开站外链接 */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;
