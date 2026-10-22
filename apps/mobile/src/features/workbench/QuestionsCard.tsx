/**
 * 问卷（同网页端 pages/workbench/QuestionsCard.tsx）：最多 6 题，每题的推荐项预先选好；
 * 单选题点一下换选项，多选题可以选几个；“其他…”自己写一句。“就按这些，出方案”交卷，“都交给你”让 agent 定。
 * 不是在等回答的问卷（答过了）收成一行，可以展开看题目。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";

import type { Question } from "@bettertavern/core/api/types";
import {
  defaultAnswers,
  toggle,
  toPayload,
  writeOther,
  type Answer,
  type Answers,
} from "@bettertavern/core/workbench/questionnaire";

import { Button, Icon } from "../../components/ui.tsx";
import { usePalette } from "../../theme/index.ts";
import { chat } from "./chatStyles.ts";

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
  const palette = usePalette();
  const { t } = useTranslation();
  const [otherOpen, setOtherOpen] = useState(false);
  return (
    <View style={{ gap: 8 }} accessibilityLabel={question.question}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
        <Text style={{ fontSize: 12, color: palette.mut }}>{index + 1}</Text>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: palette.ink }}>{question.question}</Text>
        {question.multi ? (
          <Text style={{ fontSize: 12, color: palette.mut }}>{t("workbench.questions.multi")}</Text>
        ) : null}
      </View>
      <View style={chat.choices}>
        {question.choices.map((choice, i) => {
          const on = answer.picked.includes(choice);
          return (
            <Pressable
              key={choice}
              accessibilityRole={question.multi ? "checkbox" : "radio"}
              accessibilityState={{ checked: on, disabled: readOnly }}
              disabled={readOnly}
              onPress={() => onChange(toggle(question, answer, choice))}
              style={[
                chat.choice,
                {
                  backgroundColor: on ? palette.ink : palette.card,
                  borderColor: on ? palette.ink : palette.line,
                },
              ]}
            >
              <Text style={[chat.choiceText, { color: on ? palette.bg : palette.ink }]}>{choice}</Text>
              {question.recommended === i ? (
                <Text
                  style={[
                    chat.badge,
                    on
                      ? { color: palette.bg, backgroundColor: "rgba(255,255,255,0.22)" }
                      : { color: palette.acc, backgroundColor: palette.accBg },
                  ]}
                >
                  {t("workbench.questions.recommended")}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {readOnly ? null : otherOpen || answer.other ? (
          <TextInput
            accessibilityLabel={t("workbench.questions.otherPlaceholder")}
            placeholder={t("workbench.questions.otherPlaceholder")}
            placeholderTextColor={palette.mut}
            value={answer.other}
            maxLength={200}
            autoFocus={otherOpen}
            onChangeText={(text) => onChange(writeOther(question, answer, text))}
            onBlur={() => setOtherOpen(false)}
            style={[
              chat.choice,
              { minWidth: 180, color: palette.ink, backgroundColor: palette.card, borderColor: palette.acc },
            ]}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setOtherOpen(true)}
            style={[chat.choice, { backgroundColor: palette.card, borderColor: palette.line }]}
          >
            <Text style={[chat.choiceText, { color: palette.ink2 }]}>{t("workbench.questions.other")}</Text>
          </Pressable>
        )}
      </View>
    </View>
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
  active: boolean;
  onSubmit: (answers: Record<string, string | string[]>, delegated: boolean) => Promise<void>;
}) {
  const palette = usePalette();
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

  const introText = intro ? <Text style={[chat.agentText, { color: palette.ink }]}>{intro}</Text> : null;
  if (!active && !expanded) {
    return (
      <>
        {introText}
        <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={chat.summaryLine}>
          <Icon name="list" size={14} color={palette.mut} />
          <Text style={[chat.summaryLabel, { color: palette.ink2 }]}>
            {t("workbench.questions.title", { count: questions.length })}
          </Text>
          <Text numberOfLines={1} style={[chat.summaryText, { color: palette.mut }]}>
            {questions.map((q) => q.question).join(" · ")}
          </Text>
          <Text style={[chat.link, { color: palette.acc }]}>{t("workbench.questions.expand")}</Text>
        </Pressable>
      </>
    );
  }
  return (
    <>
      {introText}
      <View style={[chat.card, { backgroundColor: palette.bg2 }]}>
        <View style={chat.cardHead}>
          <Text style={[chat.cardTitle, { color: palette.ink }]}>
            {t("workbench.questions.title", { count: questions.length })}
          </Text>
          {!active ? (
            <Pressable accessibilityRole="button" onPress={() => setExpanded(false)} hitSlop={8}>
              <Text style={[chat.link, { color: palette.acc }]}>{t("common.collapse")}</Text>
            </Pressable>
          ) : null}
        </View>
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
      </View>
      {active ? (
        <View style={chat.actions}>
          <Button
            label={t("workbench.questions.submit")}
            trailingIcon="arrowRight"
            busy={sending === "submit"}
            disabled={sending !== null}
            onPress={() => void submit(false)}
          />
          <Button
            label={t("workbench.questions.delegate")}
            variant="text"
            busy={sending === "delegate"}
            disabled={sending !== null}
            onPress={() => void submit(true)}
          />
        </View>
      ) : null}
    </>
  );
}
