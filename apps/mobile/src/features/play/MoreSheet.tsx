/**
 * 阅读页的“更多”：阅读设置（宋体 / 黑体、字号、跟随系统字体大小），重命名存档、世界状态、回到更早的一段、写结局、删除存档。
 * “回到更早的一段”生成中不能点，右边写着还能回退几次；这个存档的回退次数用完时写明已用完、不能点。
 * “写结局”只在能行动时可点（开场写完、没在生成、没有失败等着重试），故事写完结局后不再显示。
 * 阅读设置存在设备上，所有故事共用。
 * 手机上是底部面板；平板上贴着操作栏的“更多”按钮弹出（宽 340，右边缘和按钮对齐，底边在按钮上方 8，不加遮罩）。
 *
 * 漫画风（docs/design/comic/mobile/png/42）：字体是两块白底墨线的格子，选中的蓝框加蓝投影 3、样字方块填蓝；
 * 字号是“A- 17 A+”三格的步进；下面一行“跟随系统字体大小”的开关；操作在墨线格子里，删除是红字。
 */

import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { readingSize, stepSize, type ReadingFont } from "@bettertavern/core/play/reading";

import { MenuGroup, MenuItem, Sheet, Toggle } from "../../components/ui.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  hardShadow,
  serifFor,
  space,
  useComic,
} from "../../theme/index.ts";

function FontChoice() {
  const c = useComic();
  // 样字是界面文字（“宋”“黑”），按界面语言选宋体
  const { t, i18n } = useTranslation();
  const { reading, setReading } = usePrefs();
  const option = (value: ReadingFont, glyph: string, label: string) => {
    const on = reading.font === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        onPress={() => setReading({ ...reading, font: value })}
        style={({ pressed }) => [
          styles.fontOption,
          on
            ? { borderWidth: comicStroke.frame, borderColor: c.acc, boxShadow: hardShadow(c.acc, comicDepth.focus) }
            : { borderColor: c.ink },
          { backgroundColor: pressed && !on ? c.grey : c.paper },
        ]}
      >
        <View style={[styles.glyphBox, { borderColor: c.ink, backgroundColor: on ? c.acc : c.grey }]}>
          <Text
            style={{
              fontSize: 15,
              color: on ? c.onAcc : c.ink,
              fontFamily: value === "serif" ? serifFor(i18n.language) : undefined,
              fontWeight: "700",
            }}
          >
            {glyph}
          </Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: "700", color: c.ink }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("reading.font")} style={styles.fonts}>
      {option("serif", t("reading.serifSample"), t("reading.serif"))}
      {option("sans", t("reading.sansSample"), t("reading.sans"))}
    </View>
  );
}

/** 字号：“A- 17 A+”三格；中间那格读屏时可以上下调 */
function SizeControl() {
  const c = useComic();
  const { t } = useTranslation();
  const { reading, setReading } = usePrefs();
  const size = readingSize(reading);
  const step = (delta: 1 | -1): void => setReading({ ...reading, size: stepSize(reading, delta) });
  const stepButton = (label: string, glyph: string, delta: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => step(delta)}
      style={({ pressed }) => [styles.stepCell, { backgroundColor: pressed ? c.grey : c.paper }]}
    >
      <Text style={[styles.stepText, { color: c.ink }]}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { flex: 1, color: c.ink }]}>{t("reading.size")}</Text>
      <View style={[styles.stepper, { borderColor: c.ink }]}>
        {stepButton(t("reading.smaller"), "A-", -1)}
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t("reading.size")}
          accessibilityValue={{ text: `${size}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
          style={[styles.stepValue, { borderColor: c.ink, backgroundColor: c.grey }]}
        >
          <Text style={[styles.stepText, { fontFamily: font.monoMedium, color: c.ink }]}>{size}</Text>
        </View>
        {stepButton(t("reading.larger"), "A+", 1)}
      </View>
    </View>
  );
}

/** 跟随系统字体大小：打开时字号跟着系统的动态字体走；关掉时停在现在的字号 */
function FollowSystem() {
  const c = useComic();
  const { t } = useTranslation();
  const { reading, setReading } = usePrefs();
  const follow = reading.size === null;
  return (
    <View style={styles.row}>
      <Text style={{ flex: 1, fontSize: 15, color: c.ink }}>{t("reading.followSystemSize")}</Text>
      <Toggle
        value={follow}
        label={t("reading.followSystemSize")}
        onChange={(on) => setReading({ ...reading, size: on ? null : readingSize(reading) })}
      />
    </View>
  );
}

export function MoreSheet({
  visible,
  onClose,
  onRename,
  onWorld,
  onEnd,
  ending,
  onRollback,
  rollback,
  rollbacksLeft,
  onDelete,
  anchor,
  above,
}: {
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  /** 不传时不显示“世界”（闪电模式没有世界状态） */
  onWorld?: () => void;
  onEnd: () => void;
  /** 写结局：ready 可以写；busy 暂时不能（生成中、开场没写好、失败等着重试）；ended 已经写完了，不显示 */
  ending: "ready" | "busy" | "ended";
  onRollback: () => void;
  /** 回到更早的一段：见 turnMachine 的 rollbackStatus；none 时不显示 */
  rollback: "ready" | "busy" | "used_up" | "none";
  /** 这个存档还能回退几次 */
  rollbacksLeft: number;
  onDelete: () => void;
  /** 平板：菜单贴着这个按钮弹出；传了 above 时底边放在它的顶边上方 */
  anchor?: RefObject<View | null>;
  above?: RefObject<View | null>;
}) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} kind="menu" anchor={anchor} above={above} title={t("reading.title")}>
      <View style={styles.body}>
        <Text style={[styles.label, { color: c.ink }]}>{t("reading.font")}</Text>
        <FontChoice />
        <SizeControl />
        <FollowSystem />
        <MenuGroup style={{ marginTop: space.xs }}>
          <MenuItem icon="write" label={t("reading.renameSave")} onPress={onRename} />
          {onWorld ? <MenuItem icon="world" label={t("play.world")} onPress={onWorld} /> : null}
          {rollback !== "none" ? (
            <MenuItem
              icon="back"
              label={rollback === "used_up" ? t("play.rollbackUsedUp") : t("play.rollbackPick")}
              meta={rollback === "used_up" ? undefined : t("play.rollbacksLeft", { count: rollbacksLeft })}
              disabled={rollback !== "ready"}
              onPress={onRollback}
            />
          ) : null}
          {ending !== "ended" ? (
            <MenuItem
              icon="flag"
              label={t("play.writeEnding")}
              disabled={ending === "busy"}
              onPress={onEnd}
            />
          ) : null}
          <MenuItem icon="trash" label={t("reading.deleteSave")} danger onPress={onDelete} />
        </MenuGroup>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 18, paddingBottom: space.xs },
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  fonts: { flexDirection: "row", gap: space.m },
  fontOption: {
    flex: 1,
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: comicStroke.control,
    borderRadius: comicRadius.frame,
  },
  glyphBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 40 },
  stepper: {
    flexDirection: "row",
    height: 40,
    borderWidth: comicStroke.control,
    borderRadius: 11,
    overflow: "hidden",
  },
  stepCell: { width: 48, alignItems: "center", justifyContent: "center" },
  stepValue: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: comicStroke.control,
    borderRightWidth: comicStroke.control,
  },
  stepText: { fontSize: 15, fontWeight: "700" },
});
