/**
 * 对话记录的一条（同 App 的 src/features/workbench/Messages.tsx），按 kind 画：
 * 用户的话是右边的气泡；agent 的话、问卷、方案、改动、图片、进度、查资料、出错在左边，前面是 agent 的头像。
 * 交卷、回复方案是收起的一行（“✓ 答了 6 题 悬疑 · 民国……”）。
 */

import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Asset, WorkbenchMessage } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { answersSummary } from "@bettertavern/core/workbench/questionnaire";
import { fieldList, runErrorText } from "@bettertavern/core/workbench/labels";

import { Notice } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { AssetTile } from "./assets.tsx";
import { ChangesCard } from "./ChangesCard.tsx";
import styles from "./chat.module.css";
import { PlanCard } from "./PlanCard.tsx";
import { QuestionsCard } from "./QuestionsCard.tsx";

export type MessageActions = {
  /** 正在等用户回答的那一条的序号 */
  awaitedSeq: number | null;
  assets: Asset[];
  coverAssetId: string | null;
  /** 按序号找一条（交卷要知道问卷的题目） */
  find: (seq: number) => WorkbenchMessage | undefined;
  answer: (answers: Record<string, string | string[]>, delegated: boolean) => Promise<void>;
  replyPlan: (reply: { approved: true; name?: string } | { approved: false; text: string }) => Promise<void>;
  decide: (seq: number, decision: { accept?: string[]; reject?: string[]; all?: "accept" | "reject" }) => Promise<void>;
  pickCover: (asset: Asset) => Promise<boolean>;
};

export function AgentRow({ children, avatar = true }: { children: ReactNode; avatar?: boolean }) {
  return (
    <div className={styles.agentRow}>
      {avatar ? (
        <span className={styles.avatar} aria-hidden="true">
          <Icon name="workbench" size={15} />
        </span>
      ) : (
        <span className={styles.avatar} style={{ visibility: "hidden" }} aria-hidden="true" />
      )}
      <div className={styles.agentBody}>{children}</div>
    </div>
  );
}

function SummaryLine({ label, text, icon = "check" }: { label: string; text?: string; icon?: "check" | "alert" }) {
  return (
    <div className={styles.summaryLine}>
      <Icon name={icon} size={14} />
      <span className={styles.summaryLabel}>{label}</span>
      {text ? <span className={styles.summaryText}>{text}</span> : null}
    </div>
  );
}

function ResearchView({ content }: { content: { searches: string[]; pages: string[]; images: number } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const text =
    t("workbench.messages.research", { searches: content.searches.length, pages: content.pages.length }) +
    (content.images ? t("workbench.messages.researchImages", { count: content.images }) : "");
  return (
    <>
      <div className={styles.summaryLine}>
        <Icon name="search" size={14} />
        <span className={styles.summaryText}>{text}</span>
        {content.searches.length || content.pages.length ? (
          <button type="button" className={styles.linkButton} onClick={() => setOpen((o) => !o)}>
            {open ? t("common.collapse") : t("workbench.questions.expand")}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className={styles.sources}>
          {content.searches.map((query) => (
            <span key={`q:${query}`} className={styles.muted}>
              {query}
            </span>
          ))}
          {content.pages.map((url) => (
            <a key={`p:${url}`} href={url} target="_blank" rel="noreferrer noopener">
              {url}
            </a>
          ))}
        </div>
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
  const { t } = useTranslation();
  const assets = content.asset_ids
    .map((id) => actions.assets.find((a) => a.id === id))
    .filter((a): a is Asset => a !== undefined);
  const cover = content.purpose === "cover_candidates";
  return (
    <>
      <div className={styles.agentText}>
        {content.note || t(cover ? "workbench.messages.coverCandidates" : "workbench.messages.images")}
      </div>
      {assets.length ? (
        <div className={styles.images}>
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              selected={actions.coverAssetId === asset.id}
              label={t("workbench.messages.useAsCover")}
              onClick={() => void actions.pickCover(asset)}
            />
          ))}
        </div>
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

/** 用户一侧的一条（不画头像）；返回 null 表示这一条画在 agent 那边 */
function UserMessage({ message, actions }: { message: WorkbenchMessage; actions: MessageActions }) {
  const { t } = useTranslation();
  switch (message.kind) {
    case "text":
      return (
        <div className={styles.userRow}>
          <div className={styles.bubble}>{message.content.text}</div>
        </div>
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
  const { t } = useTranslation();
  const active = actions.awaitedSeq === message.seq;
  switch (message.kind) {
    case "text":
      return <div className={styles.agentText}>{message.content.text}</div>;
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
            <div className={styles.muted}>{t("workbench.messages.progressStopped")}</div>
          ) : !content.complete ? (
            <div className={styles.muted}>{t("workbench.messages.progressIncomplete")}</div>
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

/** 一条消息；avatar 为 false 时接着上一条 agent 的话，不再画头像 */
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
