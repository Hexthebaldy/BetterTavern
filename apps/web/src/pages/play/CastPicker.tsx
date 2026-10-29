/**
 * 多角色的局（docs/cast.md）阅读页上的两样：
 * - 每一段前面的说话人（CastSegments）：角色那一段左边是头像，上面一行名字；旁白那一段和普通的叙述一样；
 * - 选项上方“在场的人”一排（CastPicker）：点一个人是点名（下一段让他说话，再点取消），旁白也能点；
 *   每个人旁边的小眼睛是“先不出场 / 回来”（整局记着，回退不改）。先不出场的人变灰，点不了名。
 *   点了名时下面一行写“点名：阿苓、旁白”和“清除”。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { CastMember, Segment } from "@bettertavern/core/api/types";
import { speakerOf } from "@bettertavern/core/play/turnMachine";
import { initialOfName } from "@bettertavern/core/scenario/persona";

import { Portrait } from "../../components/comic.tsx";
import { cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./cast.module.css";

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
  return (
    <>
      {segments.map((segment, i) => {
        const last = i === segments.length - 1;
        const member = speakerOf(cast, segment);
        if (!member) return <div key={i}>{render(segment, last)}</div>;
        return (
          <div key={i} className={styles.segment}>
            <Portrait
              name={member.name}
              seed={seedOf(member)}
              glyph={initialOfName(member.name)}
              blobId={member.cover_blob_id}
              size={32}
              radius={16}
              className={styles.segmentAvatar}
            />
            <div className={styles.segmentBody}>
              <span className={styles.segmentName}>{member.name}</span>
              {render(segment, last)}
            </div>
          </div>
        );
      })}
    </>
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
  const { t } = useTranslation();
  const names = picked.map((p) =>
    p === null ? t("play.narrator") : (cast.find((m) => m.position === p)?.name ?? ""),
  );
  return (
    <div className={styles.picker} role="group" aria-label={t("play.castLabel")}>
      <p className={styles.pickerHead}>
        <b>{t("play.castLabel")}</b>
        <span>{t("play.castHint")}</span>
      </p>
      <ul className={styles.members}>
        {cast.map((member) => {
          const on = picked.includes(member.position);
          return (
            <li key={member.position} className={cx(styles.member, member.muted && styles.muted)}>
              <button
                type="button"
                className={cx(styles.pick, on && styles.pickOn)}
                aria-pressed={on}
                aria-label={t("play.castPick", { name: member.name })}
                disabled={disabled || member.muted}
                onClick={() => onToggle(member.position)}
              >
                <Portrait
                  name={member.name}
                  seed={seedOf(member)}
                  glyph={initialOfName(member.name)}
                  blobId={member.cover_blob_id}
                  size={40}
                  radius={20}
                />
                <span className={styles.memberName}>{member.name}</span>
                {member.muted ? <span className={styles.mutedTag}>{t("play.castMuted")}</span> : null}
              </button>
              <button
                type="button"
                className={styles.mute}
                aria-label={t(member.muted ? "play.castUnmuteName" : "play.castMuteName", {
                  name: member.name,
                })}
                title={member.muted ? t("play.castUnmute") : t("play.castMute")}
                disabled={disabled}
                onClick={() => onMute(member)}
              >
                <Icon name={member.muted ? "eye" : "eyeOff"} size={15} strokeWidth={2.2} />
              </button>
            </li>
          );
        })}
        <li className={styles.member}>
          <button
            type="button"
            className={cx(styles.pick, picked.includes(null) && styles.pickOn)}
            aria-pressed={picked.includes(null)}
            aria-label={t("play.castPick", { name: t("play.narrator") })}
            disabled={disabled}
            onClick={() => onToggle(null)}
          >
            <span className={styles.narratorMark} aria-hidden="true">
              <Icon name="story" size={18} strokeWidth={2.2} />
            </span>
            <span className={styles.memberName}>{t("play.narrator")}</span>
          </button>
        </li>
      </ul>
      {picked.length > 0 ? (
        <p className={styles.pickedLine}>
          <span>{t("play.castPicked", { names: names.join(t("common.listSeparator")) })}</span>
          <button type="button" className={styles.clear} onClick={onClear} disabled={disabled}>
            {t("play.castClear")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
