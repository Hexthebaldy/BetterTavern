import { Stack } from "expo-router";

import { useComic } from "../../src/theme/index.ts";

export default function AuthLayout() {
  const c = useComic();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page } }} />;
}
