import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "BetterTavern",
  slug: "bettertavern",
  scheme: "bettertavern",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "dev.bettertavern.app",
    supportsTablet: false,
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
