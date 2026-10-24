/**
 * 方案（同网页端 pages/workbench/PlanCard.tsx）：名字候选（点一下换，也可以自己起）、一句话设定、各段设定、
 * 世界书条目、开场、封面、参考资料、大概要调用几次搜索和生图。“开始写”确认，“改一改”写一句退回。
 * 不是在等确认的方案收成一行，可以展开。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, Text, View } from "react-native";

import type { Plan } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { STYLE_IDS, type StyleId } from "@bettertavern/core/workbench/labels";

import { Button, Icon, useOverlay } from "../../components/ui.tsx";
import { useComic } from "../../theme/index.ts";
import { chat } from "./chatStyles.ts";

function coverText(plan: Plan): string {
  const cover = plan.cover;
  const mode =
    cover.mode === "generate"
      ? i18n.t("workbench.plan.covers.generate", { count: cover.count || 1 })
      : i18n.t(`workbench.plan.covers.${cover.mode as "none"}`);
  const style = STYLE_IDS.has(cover.style) ? i18n.t(`workbench.cover.styles.${cover.style as StyleId}`) : cover.style;
  return [mode, style, cover.note].filter(Boolean).join(" · ");
}

function Section({ heading, children }: { heading: string; children: string }) {
  const c = useComic();
  return (
    <View style={{ gap: 4 }}>
      <Text style={[chat.heading, { color: c.mut }]}>{heading}</Text>
      <Text style={[chat.body, { color: c.ink }]}>{children}</Text>
    </View>
  );
}

function PlanBody({ plan }: { plan: Plan }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <>
      {plan.pitch ? <Section heading={t("workbench.plan.pitch")}>{plan.pitch}</Section> : null}
      {plan.sections.map((section) => (
        <Section key={section.key} heading={section.heading}>
          {section.body}
        </Section>
      ))}
      {plan.lore.length ? (
        <Section heading={t("workbench.plan.lore")}>{plan.lore.map((item) => `· ${item}`).join("\n")}</Section>
      ) : null}
      {plan.opening ? <Section heading={t("workbench.plan.opening")}>{plan.opening}</Section> : null}
      <Section heading={t("workbench.plan.cover")}>{coverText(plan)}</Section>
      {plan.sources.length ? (
        <View style={{ gap: 4 }}>
          <Text style={[chat.heading, { color: c.mut }]}>{t("workbench.plan.sources")}</Text>
          {plan.sources.map((source) => (
            <Pressable key={source.url} accessibilityRole="link" onPress={() => void Linking.openURL(source.url)}>
              <Text numberOfLines={1} style={{ fontSize: 13, color: c.acc }}>
                {source.title || source.url}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={[chat.cardMeta, { color: c.mut }]}>{t("workbench.plan.estimate", plan.estimate)}</Text>
    </>
  );
}

export function PlanCard({
  plan,
  active,
  onReply,
}: {
  plan: Plan;
  active: boolean;
  onReply: (reply: { approved: true; name?: string } | { approved: false; text: string }) => Promise<void>;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const overlay = useOverlay();
  const [names, setNames] = useState(plan.names);
  const [name, setName] = useState(plan.names[0] ?? "");
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState<"approve" | "revise" | null>(null);

  const ownName = async (): Promise<void> => {
    const text = await overlay.prompt({
      title: t("workbench.plan.ownName"),
      label: t("workbench.plan.names"),
      maxLength: 80,
    });
    const value = text?.trim();
    if (!value) return;
    setNames((list) => (list.includes(value) ? list : [...list, value]));
    setName(value);
  };

  const approve = async (): Promise<void> => {
    setSending("approve");
    try {
      await onReply({ approved: true, name: name || undefined });
    } finally {
      setSending(null);
    }
  };

  const revise = async (): Promise<void> => {
    const text = await overlay.prompt({
      title: t("workbench.plan.reviseTitle"),
      label: t("workbench.plan.reviseLabel"),
      maxLength: 2000,
    });
    if (!text?.trim()) return;
    setSending("revise");
    try {
      await onReply({ approved: false, text: text.trim() });
    } finally {
      setSending(null);
    }
  };

  if (!active && !expanded) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={chat.summaryLine}>
        <Icon name="bulb" size={14} color={c.mut} />
        <Text style={[chat.summaryLabel, { color: c.ink2 }]}>{t("workbench.plan.title")}</Text>
        <Text numberOfLines={1} style={[chat.summaryText, { color: c.mut }]}>
          {[plan.names[0], plan.pitch].filter(Boolean).join(" · ")}
        </Text>
        <Text style={[chat.link, { color: c.acc }]}>{t("workbench.questions.expand")}</Text>
      </Pressable>
    );
  }
  return (
    <>
      <View style={[chat.card, { borderColor: c.ink, backgroundColor: c.paper }]}>
        <View style={chat.cardHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="bulb" size={15} color={c.ink} />
            <Text style={[chat.cardTitle, { color: c.ink }]}>{t("workbench.plan.title")}</Text>
          </View>
          {!active ? (
            <Pressable accessibilityRole="button" onPress={() => setExpanded(false)} hitSlop={8}>
              <Text style={[chat.link, { color: c.acc }]}>{t("common.collapse")}</Text>
            </Pressable>
          ) : null}
        </View>
        {active ? (
          <View style={{ gap: 6 }}>
            <Text style={[chat.heading, { color: c.mut }]}>
              {t("workbench.plan.names")} · {t("workbench.plan.namesHint")}
            </Text>
            <View style={chat.choices}>
              {names.map((candidate) => {
                const on = candidate === name;
                return (
                  <Pressable
                    key={candidate}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setName(candidate)}
                    style={[
                      chat.choice,
                      { backgroundColor: on ? c.ink : c.paper, borderColor: on ? c.ink : c.ink },
                    ]}
                  >
                    <Text style={[chat.choiceText, { color: on ? c.paper : c.ink }]}>{candidate}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                onPress={() => void ownName()}
                style={[chat.choice, chat.dashed, { borderColor: c.ink }]}
              >
                <Text style={[chat.choiceText, { color: c.mut }]}>{t("workbench.plan.ownName")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: "900", color: c.ink }}>
            {plan.names.join(" / ")}
          </Text>
        )}
        <PlanBody plan={plan} />
      </View>
      {active ? (
        <View style={chat.actions}>
          <Button
            label={t("workbench.plan.approve")}
            trailingIcon="arrowRight"
            busy={sending === "approve"}
            disabled={sending !== null}
            onPress={() => void approve()}
          />
          <Button
            label={t("workbench.plan.revise")}
            variant="text"
            busy={sending === "revise"}
            disabled={sending !== null}
            onPress={() => void revise()}
          />
        </View>
      ) : null}
    </>
  );
}
