/**
 * 改动对比（W04，同 App 的 src/features/workbench/ChangesCard.tsx）：写好以后接着改时，agent 给出一处处改动，
 * 红底删除线是原文，绿底是改后的。“全部采用 / 逐条看 / 都不要”；逐条看时每处有“采用”“不要”。
 * 采用时那一处已经被手动改过的，服务端标成“已经手动改过，没采用”。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Hunk } from "@bettertavern/core/api/types";
import { hunkTargetLabel } from "@bettertavern/core/workbench/labels";

import { Button, cx, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import styles from "./chat.module.css";

type Decision = { accept?: string[]; reject?: string[]; all?: "accept" | "reject" };

const STATE_TONE = { accepted: "ok", rejected: "grey", stale: "warn", pending: "grey" } as const;

function HunkView({
  hunk,
  reviewing,
  busy,
  onDecide,
}: {
  hunk: Hunk;
  reviewing: boolean;
  busy: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const { t } = useTranslation();
  const decided = hunk.state !== "pending";
  return (
    <div className={cx(styles.hunk, decided && hunk.state !== "accepted" && styles.hunkDecided)}>
      <div className={styles.hunkHead}>
        <span className={styles.hunkTarget}>
          <Icon name="write" size={13} />
          {hunkTargetLabel(hunk.target)}
        </span>
        {decided ? (
          <Pill label={t(`workbench.changes.states.${hunk.state}`)} tone={STATE_TONE[hunk.state]} />
        ) : hunk.summary ? (
          <span className={styles.hunkSummary}>{hunk.summary}</span>
        ) : null}
      </div>
      {hunk.before ? <div className={styles.before}>{hunk.before}</div> : null}
      <div className={hunk.after === null ? styles.before : styles.after}>
        {hunk.after === null ? t("workbench.changes.deleted") : hunk.after}
      </div>
      {reviewing && !decided ? (
        <div className={styles.hunkActions}>
          <Button
            label={t("workbench.changes.reject")}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onDecide({ reject: [hunk.id] })}
          />
          <Button
            label={t("workbench.changes.accept")}
            size="sm"
            disabled={busy}
            onClick={() => onDecide({ accept: [hunk.id] })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ChangesCard({
  intro,
  hunks,
  active,
  onDecide,
}: {
  intro: string;
  hunks: Hunk[];
  /** 正在等用户决定 */
  active: boolean;
  onDecide: (decision: Decision) => Promise<void>;
}) {
  const { t } = useTranslation();
  const overlay = useOverlay();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = hunks.filter((h) => h.state === "pending").length;
  const accepted = hunks.filter((h) => h.state === "accepted").length;
  const open = active && pending > 0;

  const decide = async (decision: Decision, key: string): Promise<void> => {
    setBusy(key);
    try {
      await onDecide(decision);
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "DRAFT_BUSY" ? t("workbench.chat.busy") : describeError(e);
      overlay.toast(message, { icon: "alert" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {intro ? <div className={styles.agentText}>{intro}</div> : null}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>{t("workbench.changes.title", { count: hunks.length })}</span>
          {!open && pending < hunks.length ? (
            <span className={styles.cardMeta}>{t("workbench.changes.decided", { accepted })}</span>
          ) : null}
        </div>
        {hunks.map((hunk) => (
          <HunkView
            key={hunk.id}
            hunk={hunk}
            reviewing={open && reviewing}
            busy={busy !== null}
            onDecide={(decision) => void decide(decision, hunk.id)}
          />
        ))}
      </div>
      {open ? (
        <div className={styles.actions}>
          <Button
            label={t("workbench.changes.acceptAll")}
            busy={busy === "accept"}
            disabled={busy !== null}
            onClick={() => void decide({ all: "accept" }, "accept")}
          />
          {!reviewing && hunks.length > 1 ? (
            <Button
              label={t("workbench.changes.review")}
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setReviewing(true)}
            />
          ) : null}
          <Button
            label={t("workbench.changes.rejectAll")}
            variant="text"
            busy={busy === "reject"}
            disabled={busy !== null}
            onClick={() => void decide({ all: "reject" }, "reject")}
          />
        </div>
      ) : null}
    </>
  );
}
