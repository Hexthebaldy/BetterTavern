/**
 * 多角色的局（docs/cast.md）阅读页上的两样，和网页端 CastPicker.tsx 一样：
 * - 每一段前面的说话人（CastSegments）：角色那一段左边是头像，上面一行名字；旁白那一段和普通的叙述一样；
 * - 选项上方“在场的人”一排（CastPicker）：点一个人是点名（下一段让他说话，再点取消），旁白也能点；
 *   每个人右边的小眼睛是“先不出场 / 回来”（整局记着，回退不改）。先不出场的人变淡、虚线框，点不了名。
 *   点了名时下面一行写“点名：阿苓、旁白”和“清除”。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CastMember, Segment } from "@bettertavern/core/api/types";
import { speakerOf } from "@bettertavern/core/play/turnMachine";

import { Portrait } from "../../components/Portrait.tsx";
import { Icon, press } from "../../components/ui.tsx";
import { comicDepth, comicStroke, space, useComic } from "../../theme/index.ts";
import { READ_SIDE } from "./FeedParts.tsx";

/** 头像的配色按位置取，同一局里一个人始终是同一个颜色 */
function seedOf(member: CastMember): string {
  return `cast-${member.position}-${member.name}`;
}

export function CastSegments({
  segments,
  cast,
  render,
}: {
  segments: readonly Segment[];
  cast: readonly CastMember[];
  /** 一段的正文（叙述的样子由调用方决定：光标、变暗、“中断”） */
  render: (segment: Segment, last: boolean) => ReactNode;
}) {
  const c = useComic();
  return (
    <View style={styles.segments}>
      {segments.map((segment, i) => {
        const last = i === segments.length - 1;
        const member = speakerOf(cast, segment);
        if (!member) return <View key={i}>{render(segment, last)}</View>;
        return (
          <View key={i} style={styles.segment}>
            <Portrait
              name={member.name}
              seed={seedOf(member)}
              blobId={member.cover_blob_id}
              size={30}
              rounded={15}
              style={styles.segmentAvatar}
            />
            <View style={styles.segmentBody}>
              <Text style={[styles.segmentName, { color: c.mut }]}>{member.name}</Text>
              {render(segment, last)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Chip({
  label,
  on,
  muted,
  disabled,
  accessibilityLabel,
  onPress,
  avatar,
  trailing,
}: {
  label: string;
  on: boolean;
  muted?: boolean;
  disabled: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  avatar: ReactNode;
  /** 右边留出小眼睛的位置 */
  trailing?: boolean;
}) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || muted, selected: on }}
      disabled={disabled || muted}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: c.ink,
          backgroundColor: on ? c.ink : c.paper,
          borderStyle: muted ? "dashed" : "solid",
          opacity: muted ? 0.5 : 1,
          paddingRight: trailing ? 38 : 14,
        },
        press(on || pressed, comicDepth.raised - 1, c.ink),
      ]}
    >
      {avatar}
      <Text numberOfLines={1} style={[styles.chipText, { color: on ? c.paper : c.ink }]}>
        {label}
      </Text>
      {muted ? <Text style={[styles.mutedTag, { color: c.mut }]}>{t("play.castMuted")}</Text> : null}
    </Pressable>
  );
}

export function CastPicker({
  cast,
  picked,
  disabled,
  onToggle,
  onMute,
  onClear,
}: {
  cast: readonly CastMember[];
  /** 点了名的人，按点的顺序；旁白是 null */
  picked: readonly (number | null)[];
  disabled: boolean;
  onToggle: (speaker: number | null) => void;
  onMute: (member: CastMember) => void;
  onClear: () => void;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const names = picked.map((p) => (p === null ? t("play.narrator") : (cast.find((m) => m.position === p)?.name ?? "")));
  const narratorOn = picked.includes(null);
  return (
    <View style={styles.picker} accessibilityLabel={t("play.castLabel")}>
      <View style={styles.head}>
        <Text style={[styles.headTitle, { color: c.ink }]}>{t("play.castLabel")}</Text>
        <Text style={[styles.headHint, { color: c.mut }]}>{t("play.castHint")}</Text>
      </View>
      <View style={styles.members}>
        {cast.map((member) => {
          const on = picked.includes(member.position);
          return (
            <View key={member.position} style={styles.member}>
              <Chip
                label={member.name}
                on={on}
                muted={member.muted}
                disabled={disabled}
                accessibilityLabel={t("play.castPick", { name: member.name })}
                onPress={() => onToggle(member.position)}
                avatar={
                  <Portrait
                    name={member.name}
                    seed={seedOf(member)}
                    blobId={member.cover_blob_id}
                    size={34}
                    rounded={17}
                  />
                }
                trailing
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(member.muted ? "play.castUnmuteName" : "play.castMuteName", {
                  name: member.name,
                })}
                disabled={disabled}
                hitSlop={8}
                onPress={() => onMute(member)}
                style={styles.mute}
              >
                <Icon name={member.muted ? "eye" : "eyeOff"} size={16} color={on ? c.paper : c.mut} />
              </Pressable>
            </View>
          );
        })}
        <Chip
          label={t("play.narrator")}
          on={narratorOn}
          disabled={disabled}
          accessibilityLabel={t("play.castPick", { name: t("play.narrator") })}
          onPress={() => onToggle(null)}
          avatar={
            <View style={[styles.narrator, { borderColor: narratorOn ? c.paper : c.mut }]}>
              <Icon name="story" size={16} color={narratorOn ? c.paper : c.mut} />
            </View>
          }
        />
      </View>
      {picked.length > 0 ? (
        <View style={styles.pickedLine}>
          <Text style={[styles.pickedText, { color: c.mut }]}>
            {t("play.castPicked", { names: names.join(t("common.listSeparator")) })}
          </Text>
          <Pressable accessibilityRole="button" disabled={disabled} hitSlop={8} onPress={onClear}>
            <Text style={[styles.clear, { color: c.acc }]}>{t("play.castClear")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { gap: space.m },
  // 正文的段落自己左右各留 24（READ_SIDE）：头像放在 24 处，正文那一栏往左扣回 24，字紧跟在头像后面
  segment: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingLeft: READ_SIDE },
  segmentAvatar: { marginTop: 2 },
  segmentBody: { flex: 1, minWidth: 0, gap: 2, marginLeft: -READ_SIDE },
  segmentName: { fontSize: 13, lineHeight: 18, fontWeight: "800", paddingHorizontal: READ_SIDE },
  picker: { gap: 10 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 10, rowGap: 2 },
  headTitle: { fontSize: 15, fontWeight: "800" },
  headHint: { fontSize: 13, lineHeight: 18 },
  members: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  member: { position: "relative" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingVertical: 4,
    paddingLeft: 5,
    borderWidth: comicStroke.control,
    borderRadius: 999,
  },
  chipText: { fontSize: 14, fontWeight: "700", maxWidth: 120 },
  mutedTag: { fontSize: 12, fontWeight: "600" },
  mute: {
    position: "absolute",
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  narrator: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: comicStroke.chip,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  pickedLine: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  pickedText: { fontSize: 13, flexShrink: 1 },
  clear: { fontSize: 13, fontWeight: "700" },
});
