/**
 * 对话记录的一条（同网页端 pages/workbench/Messages.tsx），按 kind 画：
 * 用户的话是右边灰底墨框的气泡；agent 的话、问卷、方案、改动、图片、进度、查资料、出错在左边，前面是墨底圆形的 agent 头像。
 * 交卷、回复方案是收起的一行（“✓ 答了 6 题 悬疑 · 民国……”）。
 */

import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Asset, WorkbenchMessage } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { fieldList, runErrorText } from "@bettertavern/core/workbench/labels";
import { answersSummary } from "@bettertavern/core/workbench/questionnaire";

import { Icon, Notice, type IconName } from "../../components/ui.tsx";
import { comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";
import { AssetTile } from "./assets.tsx";
import { ChangesCard } from "./ChangesCard.tsx";
import { chat } from "./chatStyles.ts";
import { PlanCard } from "./PlanCard.tsx";
import { QuestionsCard } from "./QuestionsCard.tsx";
import type { Decision } from "./useDraftSession.ts";

export type MessageActions = {
  awaitedSeq: number | null;
  assets: Asset[];
  coverAssetId: string | null;
  find: (seq: number) => WorkbenchMessage | undefined;
  answer: (answers: Record<string, string | string[]>, delegated: boolean) => Promise<void>;
  replyPlan: (reply: { approved: true; name?: string } | { approved: false; text: string }) => Promise<void>;
  decide: (seq: number, decision: Decision) => Promise<void>;
  pickCover: (asset: Asset) => Promise<boolean>;
};

export function AgentRow({ children, avatar = true }: { children: ReactNode; avatar?: boolean }) {
  const c = useComic();
  return (
    <View style={styles.agentRow}>
      <View style={[styles.avatar, { backgroundColor: avatar ? c.ink : "transparent" }]}>
        {avatar ? <Icon name="workbench" size={16} color={c.paper} /> : null}
      </View>
      <View style={styles.agentBody}>{children}</View>
    </View>
  );
}

function SummaryLine({ label, text, icon = "check" }: { label: string; text?: string; icon?: IconName }) {
  const c = useComic();
  return (
    <View style={chat.summaryLine}>
      <Icon name={icon} size={14} color={c.mut} />
      <Text style={[chat.summaryLabel, { color: c.ink2, flexShrink: 1 }]} numberOfLines={2}>
        {label}
      </Text>
      {text ? (
        <Text numberOfLines={1} style={[chat.summaryText, { color: c.mut }]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function ResearchView({ content }: { content: { searches: string[]; pages: string[]; images: number } }) {
  const c = useComic();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const text =
    t("workbench.messages.research", { searches: content.searches.length, pages: content.pages.length }) +
    (content.images ? t("workbench.messages.researchImages", { count: content.images }) : "");
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} style={chat.summaryLine}>
        <Icon name="search" size={14} color={c.mut} />
        <Text style={[chat.summaryText, { color: c.mut }]}>{text}</Text>
        <Text style={[chat.link, { color: c.acc }]}>
          {open ? t("common.collapse") : t("workbench.questions.expand")}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 2 }}>
          {content.searches.map((query) => (
            <Text key={`q:${query}`} style={{ fontSize: 13, color: c.mut }}>
              {query}
            </Text>
          ))}
          {content.pages.map((url) => (
            <Text
              key={`p:${url}`}
              numberOfLines={1}
              onPress={() => void Linking.openURL(url)}
              style={{ fontSize: 13, color: c.acc }}
            >
              {url}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

function ImagesView({
  content,
  actions,
}: {
  content: { asset_ids: string[]; purpose: "cover_candidates" | "references"; note: string };
  actions: MessageActions;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const assets = content.asset_ids
    .map((id) => actions.assets.find((a) => a.id === id))
    .filter((a): a is Asset => a !== undefined);
  const cover = content.purpose === "cover_candidates";
  return (
    <>
      <Text style={[chat.agentText, { color: c.ink }]}>
        {content.note || t(cover ? "workbench.messages.coverCandidates" : "workbench.messages.images")}
      </Text>
      {assets.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              width={92}
              selected={actions.coverAssetId === asset.id}
              label={t("workbench.messages.useAsCover")}
              onPress={() => void actions.pickCover(asset)}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

function progressText(content: { fields: string[]; lore: { added: number }; cover: boolean }): string {
  const parts: string[] = [];
  if (content.fields.length) parts.push(fieldList(content.fields));
  if (content.lore.added) parts.push(i18n.t("workbench.messages.progressLore", { count: content.lore.added }));
  if (content.cover) parts.push(i18n.t("workbench.plan.cover"));
  return parts.join(i18n.t("common.listSeparator"));
}

function UserMessage({ message, actions }: { message: WorkbenchMessage; actions: MessageActions }) {
  const c = useComic();
  const { t } = useTranslation();
  switch (message.kind) {
    case "text":
      return (
        <View style={styles.userRow}>
          <View style={[styles.bubble, { backgroundColor: c.option, borderColor: c.ink }]}>
            <Text selectable style={[styles.bubbleText, { color: c.ink }]}>
              {message.content.text}
            </Text>
          </View>
        </View>
      );
    case "answers": {
      const { answers, delegated, questions_seq } = message.content;
      if (delegated) return <SummaryLine label={t("workbench.questions.delegated")} />;
      const source = questions_seq !== undefined ? actions.find(questions_seq) : undefined;
      const questions = source?.kind === "questions" ? source.content.questions : [];
      return (
        <SummaryLine
          label={t("workbench.questions.answered", { count: Object.keys(answers).length })}
          text={answersSummary(questions, answers)}
        />
      );
    }
    case "plan_reply": {
      const reply = message.content;
      return reply.approved ? (
        <SummaryLine label={t("workbench.plan.approved", { name: reply.name ?? "" })} />
      ) : (
        <SummaryLine label={t("workbench.plan.rejected", { text: reply.text ?? "" })} icon="alert" />
      );
    }
    default:
      return null;
  }
}

function AgentContent({ message, actions }: { message: WorkbenchMessage; actions: MessageActions }) {
  const c = useComic();
  const { t } = useTranslation();
  const active = actions.awaitedSeq === message.seq;
  switch (message.kind) {
    case "text":
      return (
        <Text selectable style={[chat.agentText, { color: c.ink }]}>
          {message.content.text}
        </Text>
      );
    case "questions":
      return (
        <QuestionsCard
          intro={message.content.intro}
          questions={message.content.questions}
          active={active}
          onSubmit={actions.answer}
        />
      );
    case "plan":
      return <PlanCard plan={message.content} active={active} onReply={actions.replyPlan} />;
    case "changes":
      return (
        <ChangesCard
          intro={message.content.intro}
          hunks={message.content.hunks}
          active={active}
          onDecide={(decision) => actions.decide(message.seq, decision)}
        />
      );
    case "images":
      return <ImagesView content={message.content} actions={actions} />;
    case "progress": {
      const content = message.content;
      const text = progressText(content);
      return (
        <>
          {text ? <SummaryLine label={t("workbench.messages.progress", { fields: text })} /> : null}
          {content.stopped ? (
            <Text style={[chat.muted, { color: c.mut }]}>{t("workbench.messages.progressStopped")}</Text>
          ) : !content.complete ? (
            <Text style={[chat.muted, { color: c.mut }]}>{t("workbench.messages.progressIncomplete")}</Text>
          ) : null}
        </>
      );
    }
    case "research":
      return <ResearchView content={message.content} />;
    case "error":
      return <Notice message={runErrorText(message.content.code)} />;
    default:
      return null;
  }
}

export const MessageView = memo(function MessageView({
  message,
  actions,
  avatar,
}: {
  message: WorkbenchMessage;
  actions: MessageActions;
  avatar: boolean;
}) {
  if (message.role === "user") {
    const user = <UserMessage message={message} actions={actions} />;
    if (message.kind === "text") return user;
    return <AgentRow avatar={false}>{user}</AgentRow>;
  }
  return (
    <AgentRow avatar={avatar}>
      <AgentContent message={message} actions={actions} />
    </AgentRow>
  );
});

const styles = StyleSheet.create({
  agentRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  agentBody: { flex: 1, minWidth: 0, gap: 10, paddingTop: 4 },
  userRow: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 48 },
  bubble: {
    flexShrink: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.option,
  },
  bubbleText: { fontSize: 15, lineHeight: 23 },
});
