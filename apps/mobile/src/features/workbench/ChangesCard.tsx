/**
 * 改动对比（同网页端 pages/workbench/ChangesCard.tsx）：写好以后接着改时，agent 给出一处处改动，
 * 红底删除线是原文，绿底是改后的。“全部采用 / 逐条看 / 都不要”；逐条看时每处有“采用”“不要”。
 * 采用时那一处已经被手动改过的，服务端标成“已经手动改过，没采用”。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Hunk } from "@bettertavern/core/api/types";
import { hunkTargetLabel } from "@bettertavern/core/workbench/labels";

import { Button, Icon, Pill, useOverlay } from "../../components/ui.tsx";
import { usePalette } from "../../theme/index.ts";
import { chat } from "./chatStyles.ts";
import type { Decision } from "./useDraftSession.ts";

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
  const palette = usePalette();
  const { t } = useTranslation();
  const decided = hunk.state !== "pending";
  return (
    <View
      style={[
        chat.card,
        { backgroundColor: palette.card, gap: 8, opacity: decided && hunk.state !== "accepted" ? 0.6 : 1 },
      ]}
    >
      <View style={chat.cardHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name="write" size={13} color={palette.ink} />
          <Text style={[chat.cardTitle, { color: palette.ink }]} numberOfLines={1}>
            {hunkTargetLabel(hunk.target)}
          </Text>
        </View>
        {decided ? (
          <Pill label={t(`workbench.changes.states.${hunk.state}`)} tone={STATE_TONE[hunk.state]} />
        ) : hunk.summary ? (
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: palette.mut }}>
            {hunk.summary}
          </Text>
        ) : null}
      </View>
      {hunk.before ? (
        <Text style={[chat.before, { color: palette.err, backgroundColor: palette.errBg }]}>{hunk.before}</Text>
      ) : null}
      {hunk.after === null ? (
        <Text style={[chat.before, { color: palette.err, backgroundColor: palette.errBg }]}>
          {t("workbench.changes.deleted")}
        </Text>
      ) : (
        <Text style={[chat.after, { color: palette.ink, backgroundColor: palette.okBg }]}>{hunk.after}</Text>
      )}
      {reviewing && !decided ? (
        <View style={[chat.actions, { justifyContent: "flex-end" }]}>
          <Button
            label={t("workbench.changes.reject")}
            variant="secondary"
            disabled={busy}
            onPress={() => onDecide({ reject: [hunk.id] })}
            style={{ minHeight: 40, height: 40 }}
          />
          <Button
            label={t("workbench.changes.accept")}
            disabled={busy}
            onPress={() => onDecide({ accept: [hunk.id] })}
            style={{ minHeight: 40, height: 40 }}
          />
        </View>
      ) : null}
    </View>
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
  active: boolean;
  onDecide: (decision: Decision) => Promise<void>;
}) {
  const palette = usePalette();
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
      {intro ? <Text style={[chat.agentText, { color: palette.ink }]}>{intro}</Text> : null}
      <View style={[chat.card, { backgroundColor: palette.bg2 }]}>
        <View style={chat.cardHead}>
          <Text style={[chat.cardTitle, { color: palette.ink }]}>
            {t("workbench.changes.title", { count: hunks.length })}
          </Text>
          {!open && pending < hunks.length ? (
            <Text style={[chat.cardMeta, { color: palette.mut }]}>
              {t("workbench.changes.decided", { accepted })}
            </Text>
          ) : null}
        </View>
        {hunks.map((hunk) => (
          <HunkView
            key={hunk.id}
            hunk={hunk}
            reviewing={open && reviewing}
            busy={busy !== null}
            onDecide={(decision) => void decide(decision, hunk.id)}
          />
        ))}
      </View>
      {open ? (
        <View style={chat.actions}>
          <Button
            label={t("workbench.changes.acceptAll")}
            busy={busy === "accept"}
            disabled={busy !== null}
            onPress={() => void decide({ all: "accept" }, "accept")}
          />
          {!reviewing && hunks.length > 1 ? (
            <Button
              label={t("workbench.changes.review")}
              variant="secondary"
              disabled={busy !== null}
              onPress={() => setReviewing(true)}
            />
          ) : null}
          <Button
            label={t("workbench.changes.rejectAll")}
            variant="text"
            busy={busy === "reject"}
            disabled={busy !== null}
            onPress={() => void decide({ all: "reject" }, "reject")}
          />
        </View>
      ) : null}
    </>
  );
}
