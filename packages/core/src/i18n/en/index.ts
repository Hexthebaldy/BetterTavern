/** 英文资源：形状由中文资源推出（types.ts） */

import type { Messages } from "../types.ts";
import type { zh } from "../zh/index.ts";
import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { library } from "./library.ts";
import { lorebook } from "./lorebook.ts";
import { play } from "./play.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { stories } from "./stories.ts";
import { workbench } from "./workbench.ts";

export const en: Messages<typeof zh> = {
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
