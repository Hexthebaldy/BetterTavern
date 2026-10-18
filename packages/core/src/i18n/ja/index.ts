/** 日文资源：形状由中文资源推出（types.ts）；日文没有单复数，复数只写 _other，和中文一样 */

import type { MessagesOtherOnly } from "../types.ts";
import type { zh } from "../zh/index.ts";
import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { library } from "./library.ts";
import { play } from "./play.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";
import { stories } from "./stories.ts";

export const ja: MessagesOtherOnly<typeof zh> = {
  ...common,
  ...shell,
  ...auth,
  ...stories,
  ...play,
  ...library,
  ...settings,
};
