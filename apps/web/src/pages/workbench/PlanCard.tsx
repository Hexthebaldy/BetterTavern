/**
 * 方案（W02 之后，同 App 的 src/features/workbench/PlanCard.tsx）：名字候选（点一下换，也可以自己起）、一句话设定、
 * 各段设定、世界书条目、开场、封面、参考资料、大概要调用几次搜索和生图。“开始写”确认，“改一改”写一句退回。
 * 不是在等确认的方案收成一行，可以展开。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { i18n } from "@bettertavern/core/i18n/index";
import type { Plan } from "@bettertavern/core/api/types";
import { STYLE_IDS, type StyleId } from "@bettertavern/core/workbench/labels";

import { Button, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import styles from "./chat.module.css";

function coverText(plan: Plan): string {
  const cover = plan.cover;
  const mode =
    cover.mode === "generate"
      ? i18n.t("workbench.plan.covers.generate", { count: cover.count || 1 })
      : i18n.t(`workbench.plan.covers.${cover.mode as "none"}`);
  const style = STYLE_IDS.has(cover.style) ? i18n.t(`workbench.cover.styles.${cover.style as StyleId}`) : cover.style;
  return [mode, style, cover.note].filter(Boolean).join(" · ");
}

function PlanBody({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  return (
    <>
      {plan.pitch ? (
        <div className={styles.planSection}>
          <span className={styles.planHeading}>{t("workbench.plan.pitch")}</span>
          <span className={styles.planPitch}>{plan.pitch}</span>
        </div>
      ) : null}
      {plan.sections.map((section) => (
        <div key={section.key} className={styles.planSection}>
          <span className={styles.planHeading}>{section.heading}</span>
          <span className={styles.planBody}>{section.body}</span>
        </div>
      ))}
      {plan.lore.length ? (
        <div className={styles.planSection}>
          <span className={styles.planHeading}>{t("workbench.plan.lore")}</span>
          <ul className={styles.planList}>
            {plan.lore.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.opening ? (
        <div className={styles.planSection}>
          <span className={styles.planHeading}>{t("workbench.plan.opening")}</span>
          <span className={styles.planBody}>{plan.opening}</span>
        </div>
      ) : null}
      <div className={styles.planSection}>
        <span className={styles.planHeading}>{t("workbench.plan.cover")}</span>
        <span className={styles.planBody}>{coverText(plan)}</span>
      </div>
      {plan.sources.length ? (
        <div className={styles.planSection}>
          <span className={styles.planHeading}>{t("workbench.plan.sources")}</span>
          <div className={styles.sources}>
            {plan.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener">
                {source.title || source.url}
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <span className={styles.cardMeta}>{t("workbench.plan.estimate", plan.estimate)}</span>
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
  const { t } = useTranslation();
  const overlay = useOverlay();
  const [names, setNames] = useState(plan.names);
  const [name, setName] = useState(plan.names[0] ?? "");
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState<"approve" | "revise" | null>(null);

  const ownName = async (): Promise<void> => {
    const text = await overlay.prompt({ title: t("workbench.plan.ownName"), label: t("workbench.plan.names"), maxLength: 80 });
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
      <div className={styles.summaryLine}>
        <Icon name="bulb" size={14} />
        <span className={styles.summaryLabel}>{t("workbench.plan.title")}</span>
        <span className={styles.summaryText}>{[plan.names[0], plan.pitch].filter(Boolean).join(" · ")}</span>
        <button type="button" className={styles.linkButton} onClick={() => setExpanded(true)}>
          {t("workbench.questions.expand")}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>
            <Icon name="bulb" size={15} />
            {t("workbench.plan.title")}
          </span>
          {!active ? (
            <button type="button" className={styles.linkButton} onClick={() => setExpanded(false)}>
              {t("common.collapse")}
            </button>
          ) : null}
        </div>
        {active ? (
          <div className={styles.planSection}>
            <span className={styles.planHeading}>
              {t("workbench.plan.names")} · {t("workbench.plan.namesHint")}
            </span>
            <div className={styles.choices}>
              {names.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={cx(styles.choice, candidate === name && styles.choiceOn)}
                  aria-pressed={candidate === name}
                  onClick={() => setName(candidate)}
                >
                  {candidate}
                </button>
              ))}
              <button type="button" className={styles.choice} onClick={() => void ownName()}>
                {t("workbench.plan.ownName")}
              </button>
            </div>
          </div>
        ) : (
          <span className={styles.planName}>{plan.names.join(" / ")}</span>
        )}
        <PlanBody plan={plan} />
      </div>
      {active ? (
        <div className={styles.actions}>
          <Button
            label={t("workbench.plan.approve")}
            trailingIcon="arrowRight"
            busy={sending === "approve"}
            disabled={sending !== null}
            onClick={() => void approve()}
          />
          <Button
            label={t("workbench.plan.revise")}
            variant="text"
            busy={sending === "revise"}
            disabled={sending !== null}
            onClick={() => void revise()}
          />
        </div>
      ) : null}
    </>
  );
}
