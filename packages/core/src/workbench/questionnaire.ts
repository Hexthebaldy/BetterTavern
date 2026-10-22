/**
 * 问卷的作答（手机和网页共用）：每题预先选好推荐项；单选题可以换选项或者在“其他”里自己写；
 * 多选题可以选几个。交卷时没动过的题也按当前的选择交上去（服务端也会按推荐项补）。
 */

import type { Question } from "../api/types.ts";

export type Answer = { picked: string[]; other: string };

export type Answers = Record<string, Answer>;

export function defaultAnswers(questions: readonly Question[]): Answers {
  const answers: Answers = {};
  for (const q of questions) {
    const recommended = q.recommended !== null ? q.choices[q.recommended] : undefined;
    answers[q.qid] = { picked: recommended !== undefined ? [recommended] : [], other: "" };
  }
  return answers;
}

/** 点一个选项：单选题换成它；多选题切换它 */
export function toggle(question: Question, answer: Answer, choice: string): Answer {
  if (!question.multi) return { picked: [choice], other: "" };
  const picked = answer.picked.includes(choice)
    ? answer.picked.filter((c) => c !== choice)
    : [...answer.picked, choice];
  return { ...answer, picked };
}

/** 在“其他”里自己写：单选题就用写的这句（清掉选项），多选题加在选项后面 */
export function writeOther(question: Question, answer: Answer, text: string): Answer {
  return question.multi ? { ...answer, other: text } : { picked: [], other: text };
}

/** 交给服务端的回答：单选题是一个字符串，多选题是数组；什么都没选的题不交（服务端按推荐项补） */
export function toPayload(questions: readonly Question[], answers: Answers): Record<string, string | string[]> {
  const payload: Record<string, string | string[]> = {};
  for (const q of questions) {
    const answer = answers[q.qid];
    if (!answer) continue;
    const other = answer.other.trim();
    if (q.multi) {
      const picked = other ? [...answer.picked, other] : answer.picked;
      if (picked.length) payload[q.qid] = picked;
    } else {
      const value = other || answer.picked[0];
      if (value) payload[q.qid] = value;
    }
  }
  return payload;
}

/** 收起来的一行摘要：“悬疑 · 民国 · …” */
export function answersSummary(
  questions: readonly Question[],
  answers: Record<string, string | string[]>,
  separator = " · ",
): string {
  return questions
    .map((q) => answers[q.qid])
    .filter((a): a is string | string[] => a !== undefined)
    .map((a) => (Array.isArray(a) ? a.join("、") : a))
    .filter(Boolean)
    .join(separator);
}
