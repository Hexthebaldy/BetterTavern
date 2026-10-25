/** 中文资源：源语言，所有 key 在这里定义（按领域分文件） */

import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { library } from "./library.ts";
import { lorebook } from "./lorebook.ts";
import { play } from "./play.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { stories } from "./stories.ts";
import { workbench } from "./workbench.ts";

export const zh = {
  ...common,
  ...shell,
  ...auth,
  ...stories,
  ...play,
  ...library,
  ...lorebook,
  ...workbench,
  ...settings,
};
