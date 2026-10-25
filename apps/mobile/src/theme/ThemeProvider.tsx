/**
 * 当前主题的上下文。根布局按用户的外观设置包一层 ThemeProvider，页面用 useComic() / useIsDark() 取值。
 *
 * 选了固定主题时用 Appearance.setColorScheme() 覆盖系统的深浅，键盘、系统弹窗、状态栏跟着 App 走；
 * 跟随系统时清掉覆盖。系统的深浅由这里自己存一份（system）：清掉覆盖时 RN 只更新它缓存的值、不发 change 事件
 * （Expo Go 里原生那边也收不到深浅变化的通知），光靠 useColorScheme() 会停在覆盖时的值——从“夜间”切回
 * “跟随系统”还是黑的。所以清掉覆盖后马上读一次；覆盖期间收到的变化是覆盖后的值，不当成系统的。
 *
 * 漫画风的颜色（@bettertavern/design 的 comic.ts）按主题取，useComic() 拿当前这一套。
 *
 * 平板两栏页面的详情区是一块灰底，里面的格子是白色：用 RaisedSurface 把这一片的页面底色换成详情区的灰，
 * 页面主体不用改就能放进去。浮起来的面板、对话框用 BaseSurface 换回原来的颜色。
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Appearance, useColorScheme, type ColorSchemeName } from "react-native";

import { COMIC_COLORS, type ComicColors } from "@bettertavern/design/comic";
import {
  resolveTheme,
  THEMES,
  type ThemeDef,
  type ThemeId,
  type ThemeSetting,
} from "@bettertavern/design/themes";

const ThemeContext = createContext<ThemeDef | null>(null);
/** 在详情区（RaisedSurface）里 */
const RaisedContext = createContext(false);

/** 详情区里的漫画颜色：页面底色换成详情区的灰，格子照旧是纸色 */
const RAISED_COMIC: Record<ThemeId, ComicColors> = {
  light: { ...COMIC_COLORS.light, page: COMIC_COLORS.light.detail },
  night: { ...COMIC_COLORS.night, page: COMIC_COLORS.night.detail },
};

export function ThemeProvider({ setting, children }: { setting: ThemeSetting; children: ReactNode }) {
  // 挂上时还没有覆盖，读到的就是系统的
  const [system, setSystem] = useState<ColorSchemeName | null | undefined>(() => Appearance.getColorScheme());
  const settingRef = useRef(setting);
  settingRef.current = setting;
  const theme = THEMES[resolveTheme(setting, system)];

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (settingRef.current === "system") setSystem(colorScheme);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (setting === "system") {
      Appearance.setColorScheme("unspecified");
      setSystem(Appearance.getColorScheme());
    } else {
      Appearance.setColorScheme(THEMES[setting].scheme);
    }
  }, [setting]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function RaisedSurface({ children }: { children: ReactNode }) {
  return <RaisedContext.Provider value>{children}</RaisedContext.Provider>;
}

/** 换回页面原来的底色：浮在页面上的面板、对话框不跟着所在那一片变 */
export function BaseSurface({ children }: { children: ReactNode }) {
  return <RaisedContext.Provider value={false}>{children}</RaisedContext.Provider>;
}

/** 当前主题；在 ThemeProvider 外面（启动早期）按系统深浅取 */
export function useTheme(): ThemeDef {
  const theme = useContext(ThemeContext);
  const system = useColorScheme();
  return theme ?? THEMES[resolveTheme("system", system)];
}

/** 当前主题的漫画颜色；在详情区（RaisedSurface）里页面底色是详情区的灰 */
export function useComic(): ComicColors {
  const theme = useTheme();
  const raised = useContext(RaisedContext);
  return (raised ? RAISED_COMIC : COMIC_COLORS)[theme.id];
}

/** 当前主题是不是深色基调 */
export function useIsDark(): boolean {
  return useTheme().scheme === "dark";
}
