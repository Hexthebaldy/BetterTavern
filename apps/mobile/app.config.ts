import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "BetterTavern",
  slug: "bettertavern",
  scheme: "bettertavern",
  version: "0.1.0",
  // 不锁方向：iPad 要参与分屏和台前调度，必须支持所有方向；Android 平板和 Expo Go 也看这一项。
  // iOS 上它被下面的 ios.infoPlist 覆盖（只给 iPhone 竖屏），prebuild 时会提示“Ignoring abstract property orientation”，是预期的。
  // 手机锁竖屏另见 src/utils/orientation.ts
  orientation: "default",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "dev.bettertavern.app",
    supportsTablet: true,
    // iPhone 只竖屏（写在 infoPlist 里会覆盖上面的 orientation）；iPad 的 UISupportedInterfaceOrientations~ipad
    // 在 supportsTablet 打开、requireFullScreen 关着时由 Expo 自动填成全部四个方向
    infoPlist: {
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
      ],
    },
  },
  android: {
    package: "dev.bettertavern.app",
  },
  plugins: ["expo-router", "expo-status-bar", "expo-font"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
