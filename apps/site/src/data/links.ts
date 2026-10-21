/** 仓库里的链接：文件用 blob/HEAD/…，跟着默认分支走 */

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

/** 新窗口打开站外链接 */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;
