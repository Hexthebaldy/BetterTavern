/**
 * 部署一节的四组命令。每行是 ["$", 命令] 或 ["#", 注释的键]；注释的文字在各语言的文案里（copy.deploy.notes）。
 * 复制时命令不带 "$ "，注释带 "# "。命令、路径和端口都和仓库里一致：Makefile、deploy/docker-compose.yml、docs/development.md。
 */

export type DeployTabId = "docker" | "source" | "web" | "mobile";
export type DeployNote =
  | "keygen"
  | "listen"
  | "localPg"
  | "worker"
  | "apiDocs"
  | "browser"
  | "webBuild"
  | "mobileIp"
  | "expoGo";

export type CommandLine = readonly ["$", string] | readonly ["#", DeployNote];

export type DeployTab = { id: DeployTabId; lines: readonly CommandLine[] };

const CLONE: readonly CommandLine[] = [
  ["$", "git clone https://github.com/Hexthebaldy/BetterTavern.git"],
  ["$", "cd BetterTavern"],
];

export const DEPLOY_TABS: readonly DeployTab[] = [
  {
    id: "docker",
    lines: [
      ...CLONE,
      ["#", "keygen"],
      ["$", "docker compose -f deploy/docker-compose.yml run --rm migrate bettertavern keygen"],
      ["$", "docker compose -f deploy/docker-compose.yml up -d"],
      ["#", "listen"],
    ],
  },
  {
    id: "source",
    lines: [
      ...CLONE,
      ["$", "cp apps/server/.env.example apps/server/.env"],
      ["#", "localPg"],
      ["$", "make db-up"],
      ["$", "make install && make migrate"],
      ["$", "make dev"],
      ["#", "worker"],
      ["$", "make worker"],
      ["#", "apiDocs"],
    ],
  },
  {
    id: "web",
    lines: [
      ["$", "make js-install"],
      ["$", "make web"],
      ["#", "browser"],
      ["#", "webBuild"],
    ],
  },
  {
    id: "mobile",
    lines: [
      ["$", "cp apps/mobile/.env.example apps/mobile/.env"],
      ["#", "mobileIp"],
      ["$", "make mobile-install"],
      ["$", "cd apps/mobile && npm start"],
      ["#", "expoGo"],
    ],
  },
];

/** 一行显示的文字：命令原样，注释换成这种语言的文字 */
export function lineText(line: CommandLine, notes: Readonly<Record<DeployNote, string>>): string {
  return line[0] === "#" ? notes[line[1]] : line[1];
}

/** 复制到剪贴板的文字：命令原样，注释带 "# "，一行一条 */
export function commandText(
  lines: readonly CommandLine[],
  notes: Readonly<Record<DeployNote, string>>,
): string {
  return lines.map((l) => (l[0] === "#" ? `# ${notes[l[1]]}` : l[1])).join("\n");
}
