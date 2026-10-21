/**
 * 部署一节的四组命令。每行是 ["$", 命令] 或 ["#", 注释]；复制时命令不带 "$ "，注释带 "# "。
 * 命令、路径和端口都和仓库里一致：Makefile、deploy/docker-compose.yml、docs/development.md。
 */

export type CommandLine = readonly ["$" | "#", string];

export type DeployTab = {
  id: "docker" | "source" | "web" | "mobile";
  label: string;
  /** 命令框的无障碍名称 */
  aria: string;
  lines: readonly CommandLine[];
};

const CLONE: readonly CommandLine[] = [
  ["$", "git clone https://github.com/Hexthebaldy/BetterTavern.git"],
  ["$", "cd BetterTavern"],
];

export const DEPLOY_TABS: readonly DeployTab[] = [
  {
    id: "docker",
    label: "Docker",
    aria: "用 Docker 部署服务器",
    lines: [
      ...CLONE,
      ["#", "生成密钥，把输出的两行写进 deploy/.env"],
      ["$", "docker compose -f deploy/docker-compose.yml run --rm migrate bettertavern keygen"],
      ["$", "docker compose -f deploy/docker-compose.yml up -d"],
      ["#", "接口监听 127.0.0.1:8000，对外访问要放在带 TLS 的反向代理后面"],
    ],
  },
  {
    id: "source",
    label: "源码",
    aria: "从源码运行服务器",
    lines: [
      ...CLONE,
      ["$", "cp apps/server/.env.example apps/server/.env"],
      ["#", "用 Docker 起 PostgreSQL；用本机的 PostgreSQL 16 就跳过这一行，改 .env 里的 DATABASE_URL"],
      ["$", "make db-up"],
      ["$", "make install && make migrate"],
      ["$", "make dev"],
      ["#", "另开一个终端，启动整理世界状态的后台任务"],
      ["$", "make worker"],
      ["#", "接口文档：http://localhost:8000/docs"],
    ],
  },
  {
    id: "web",
    label: "网页",
    aria: "启动网页客户端",
    lines: [
      ["$", "make js-install"],
      ["$", "make web"],
      ["#", "浏览器打开 http://localhost:5173"],
      ["#", "部署时用 make web-build 生成 apps/web/dist，和接口放在同一个域名下"],
    ],
  },
  {
    id: "mobile",
    label: "手机",
    aria: "启动手机客户端",
    lines: [
      ["$", "cp apps/mobile/.env.example apps/mobile/.env"],
      ["#", "把 apps/mobile/.env 里的地址改成电脑的局域网 IP"],
      ["$", "make mobile-install"],
      ["$", "cd apps/mobile && npm start"],
      ["#", "手机上用 Expo Go 扫终端里的二维码"],
    ],
  },
];

/** 复制到剪贴板的文字：命令原样，注释带 "# "，一行一条 */
export function commandText(lines: readonly CommandLine[]): string {
  return lines.map(([kind, text]) => (kind === "#" ? `# ${text}` : text)).join("\n");
}
