import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "BetterTavern",
  slug: "bettertavern",
  scheme: "bettertavern",
  version: "0.1.0",
  // App 图标“错版”（docs/design/logo）。Android 旧版启动器、Expo Go 等用这一张；iOS 和 Android 自适应图标见下面各自的配置
  icon: "./assets/icon.png",
  // 不锁方向：iPad 要参与分屏和台前调度，必须支持所有方向；Android 平板和 Expo Go 也看这一项。
  // iOS 上它被下面的 ios.infoPlist 覆盖（只给 iPhone 竖屏），prebuild 时会提示“Ignoring abstract property orientation”，是预期的。
  // 手机锁竖屏另见 src/utils/orientation.ts
  orientation: "default",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "dev.bettertavern.app",
    supportsTablet: true,
    // 浅色、深色、着色三套，iOS 18 起跟随系统外观切换（深色和着色是透明底，背景由系统画）
    icon: {
      light: "./assets/icon.png",
      dark: "./assets/icon-dark.png",
      tinted: "./assets/icon-tinted.png",
    },
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
    // 自适应图标：前景缩在 66dp 安全区内，白底；Android 13+ 的主题图标用单色版
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#FFFFFF",
    },
  },
  plugins: [
    "expo-router",
    "expo-status-bar",
    "expo-font",
    // 自己部署的服务器多半是局域网里的 http:// 地址；Android 9 起正式包默认只许连 https，这里放开。
    // Expo Go 和开发版本来就允许，所以只有打出来的安装包需要它
    ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
  ],
  experiments: {
    typedRoutes: true,
  },
  // EAS 上的项目（打包用，见 README 的“打包 Android 安装包”）
  owner: "asher77",
  extra: {
    eas: { projectId: "f5d2aaf3-3f94-416d-a71f-04b6a75df224" },
  },
};

export default config;
