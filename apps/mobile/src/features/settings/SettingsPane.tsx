/**
 * 宽屏设置两栏的右栏（设计稿 T13、T14）：从左栏右边 24 开始，到屏幕右边留 16，上下各留 16，圆角 32，底色 bg2，
 * 里面的卡片是白色（RaisedSurface 把这一片的色板换成“灰底白卡”）。
 *
 * 左栏点哪一项，右栏就从那一项开始；右栏里再往下一层（模型列表 → 模型详情）时压进一个小栈，
 * 顶上显示“‹ 上一层名字”胶囊，左栏不动。页面主体和路由页面是同一份（screens/、../probe/ProbeBody.tsx），
 * 跳转经 SettingsNavProvider 换成这个栈。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gutter, settingsDetailLeft } from "@bettertavern/design/layout";

import { Icon, InColumnContext } from "../../components/ui.tsx";
import { RaisedSurface, space, usePalette } from "../../theme/index.ts";
import { ProbeBody } from "../probe/ProbeBody.tsx";
import { SettingsNavProvider, type SettingsNav, type SettingsTarget } from "./nav.tsx";
import { AccountBody } from "./screens/AccountBody.tsx";
import { ModelBody } from "./screens/ModelBody.tsx";
import { ModelsBody } from "./screens/ModelsBody.tsx";
import { ToolsBody } from "./screens/ToolsBody.tsx";

function keyOf(target: SettingsTarget): string {
  return target.screen === "model" ? `model:${target.id}` : target.screen;
}

function Body({ target }: { target: SettingsTarget }) {
  switch (target.screen) {
    case "models":
      return <ModelsBody />;
    case "model":
      return <ModelBody id={target.id} />;
    case "tools":
      return <ToolsBody />;
    case "account":
      return <AccountBody />;
    case "probe":
      return <ProbeBody />;
  }
}

export function SettingsPane({
  root,
  onNavigate,
}: {
  /** 左栏选中的那一项 */
  root: SettingsTarget;
  /** 右栏里往下走或返回之后：左栏重新取一次数据（比如刚换了导演模型） */
  onNavigate: () => void;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [stack, setStack] = useState<SettingsTarget[]>([root]);
  const rootKey = keyOf(root);

  // 左栏换了一项：右栏从那一项重新开始
  useEffect(() => {
    setStack([root]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey]);

  const nav = useMemo<SettingsNav>(
    () => ({
      embedded: true,
      open: (target) => {
        setStack((current) => [...current, target]);
        onNavigate();
      },
      back: () => {
        setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
        onNavigate();
      },
    }),
    [onNavigate],
  );

  const top = stack[stack.length - 1] ?? root;
  const parent = stack.length > 1 ? stack[stack.length - 2] : undefined;
  return (
    <View
      style={[
        styles.pane,
        {
          left: settingsDetailLeft(),
          top: Math.max(gutter.detailEdge, insets.top + space.s),
          bottom: Math.max(gutter.detailEdge, insets.bottom),
          backgroundColor: palette.bg2,
        },
      ]}
    >
      {parent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.backTo", { page: t(`settings.pages.${parent.screen}`) })}
          onPress={nav.back}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: palette.card, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Icon name="back" size={18} />
          <Text style={{ fontSize: 14, color: palette.ink }}>{t(`settings.pages.${parent.screen}`)}</Text>
        </Pressable>
      ) : null}
      <RaisedSurface>
        <InColumnContext.Provider value>
          <SettingsNavProvider value={nav}>
            <View key={keyOf(top)} style={{ flex: 1 }}>
              <Body target={top} />
            </View>
          </SettingsNavProvider>
        </InColumnContext.Provider>
      </RaisedSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    position: "absolute",
    right: gutter.detailEdge,
    borderRadius: 32,
    overflow: "hidden",
    paddingHorizontal: space.m,
    paddingTop: space.m,
  },
  back: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    marginTop: space.s,
    marginLeft: space.m,
    paddingLeft: 6,
    paddingRight: space.l,
    borderRadius: 20,
  },
});
