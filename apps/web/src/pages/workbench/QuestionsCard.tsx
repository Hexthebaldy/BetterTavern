/**
 * 问卷（W02，同 App 的 src/features/workbench/QuestionsCard.tsx）：最多 6 题，每题的推荐项预先选好；
 * 单选题点一下换选项，多选题可以选几个；“其他…”自己写一句。“就按这些，出方案”交卷，“都交给你”让 agent 定。
 * 不是在等回答的问卷（答过了）收成一行，可以展开看题目。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Question } from "@bettertavern/core/api/types";
import {
  defaultAnswers,
  toggle,
  toPayload,
  writeOther,
  type Answer,
  type Answers,
} from "@bettertavern/core/workbench/questionnaire";

import { Button, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./chat.module.css";

function QuestionRow({
  index,
  question,
  answer,
  onChange,
  readOnly,
}: {
  index: number;
  question: Question;
  answer: Answer;
  onChange: (answer: Answer) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [otherOpen, setOtherOpen] = useState(false);
  return (
    <div className={styles.question} role="group" aria-label={question.question}>
      <div className={styles.questionTitle}>
        <span className={styles.questionIndex}>{index + 1}</span>
        <span>{question.question}</span>
        {question.multi ? <span className={styles.questionMulti}>{t("workbench.questions.multi")}</span> : null}
      </div>
      <div className={styles.choices}>
        {question.choices.map((choice, i) => {
          const on = answer.picked.includes(choice);
          return (
            <button
              key={choice}
              type="button"
              className={cx(styles.choice, on && styles.choiceOn)}
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => onChange(toggle(question, answer, choice))}
            >
              {choice}
              {question.recommended === i ? (
                <span className={styles.badge}>{t("workbench.questions.recommended")}</span>
              ) : null}
            </button>
          );
        })}
        {readOnly ? null : otherOpen || answer.other ? (
          <input
            className={styles.otherInput}
            aria-label={t("workbench.questions.otherPlaceholder")}
            placeholder={t("workbench.questions.otherPlaceholder")}
            value={answer.other}
            maxLength={200}
            // 点了“其他…”才出现，出现时直接能打字
            autoFocus={otherOpen}
            onChange={(e) => onChange(writeOther(question, answer, e.target.value))}
            onBlur={() => setOtherOpen(false)}
          />
        ) : (
          <button type="button" className={styles.choice} onClick={() => setOtherOpen(true)}>
            {t("workbench.questions.other")}
          </button>
        )}
      </div>
    </div>
  );
}

export function QuestionsCard({
  intro,
  questions,
  active,
  onSubmit,
}: {
  intro: string;
  questions: Question[];
  /** 正在等回答 */
  active: boolean;
  onSubmit: (answers: Record<string, string | string[]>, delegated: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Answers>(() => defaultAnswers(questions));
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState<"submit" | "delegate" | null>(null);

  const submit = async (delegated: boolean): Promise<void> => {
    setSending(delegated ? "delegate" : "submit");
    try {
      await onSubmit(delegated ? {} : toPayload(questions, answers), delegated);
    } finally {
      setSending(null);
    }
  };

  const introText = intro ? <div className={styles.agentText}>{intro}</div> : null;
  if (!active && !expanded) {
    return (
      <>
        {introText}
        <div className={styles.summaryLine}>
          <Icon name="list" size={14} />
          <span className={styles.summaryLabel}>{t("workbench.questions.title", { count: questions.length })}</span>
          <span className={styles.summaryText}>{questions.map((q) => q.question).join(" · ")}</span>
          <button type="button" className={styles.linkButton} onClick={() => setExpanded(true)}>
            {t("workbench.questions.expand")}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {introText}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>{t("workbench.questions.title", { count: questions.length })}</span>
          {!active ? (
            <button type="button" className={styles.linkButton} onClick={() => setExpanded(false)}>
              {t("common.collapse")}
            </button>
          ) : null}
        </div>
        {questions.map((question, index) => (
          <QuestionRow
            key={question.qid}
            index={index}
            question={question}
            readOnly={!active}
            answer={answers[question.qid] ?? { picked: [], other: "" }}
            onChange={(answer) => setAnswers((a) => ({ ...a, [question.qid]: answer }))}
          />
        ))}
      </div>
      {active ? (
        <div className={styles.actions}>
          <Button
            label={t("workbench.questions.submit")}
            trailingIcon="arrowRight"
            busy={sending === "submit"}
            disabled={sending !== null}
            onClick={() => void submit(false)}
          />
          <Button
            label={t("workbench.questions.delegate")}
            variant="text"
            busy={sending === "delegate"}
            disabled={sending !== null}
            onClick={() => void submit(true)}
          />
        </div>
      ) : null}
    </>
  );
}
