/**
 * 新建剧本（/scenario/new，?card= 预先选好一张）和编辑剧本（/scenario/:id/edit），同 App 的 app/scenario/form.tsx：
 * 1. 从角色卡仓库选一张或几张卡（最多 8 张，群像剧本），可以调先后，第一张是主角色；
 * 2. 剧本名（不填就用第一张卡的名字）；
 * 3. 默认主角和偏好：开新故事时预填（和“开始新的故事”是同一个表单，StartForm.tsx）；
 * 4. 开场：用其中一张卡的开场白或某条备选开场白（导演不重写），或者让导演根据设定写一个。
 * 编辑时带版本号保存，别处改过（409 SCENARIO_CHANGED）就重新读一次。
 */

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { CardDetail, Scenario, ScenarioSetup } from "@bettertavern/core/api/types";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, Dots, Field, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { scenarioPath } from "../../data/scenarioActions.ts";
import { scenariosKey, useCards } from "../../data/scenarios.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { desktop } from "../../theme/layout.ts";
import styles from "./scenario.module.css";
import { StartForm, type StartValues } from "./StartForm.tsx";

const MAX_CARDS = 8;

type Opening = ScenarioSetup["opening"];

function Form({ scenario, presetCard }: { scenario: Scenario | null; presetCard: string | null }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const wide = useWindowWidth() >= desktop.rail;
  const cards = useCards();
  const [picked, setPicked] = useState<string[]>(() =>
    scenario ? scenario.cards.map((c) => c.card_id) : presetCard ? [presetCard] : [],
  );
  const [name, setName] = useState(scenario?.name ?? "");
  const [values, setValues] = useState<StartValues | null>(null);
  const [opening, setOpening] = useState<Opening>(scenario?.setup.opening ?? null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // 选了的卡的全文（列开场白用）
  const details = useQueries({
    queries: picked.map((id) => ({ queryKey: ["card", id], queryFn: () => api.cards.get(id), staleTime: 60_000 })),
  });
  const detailOf = useMemo(() => {
    const map = new Map<string, CardDetail>();
    for (const q of details) if (q.data) map.set(q.data.card.id, q.data);
    return map;
  }, [details]);

  const all = cards.data ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const rest = all.filter((c) => !picked.includes(c.id));

  const toggle = (id: string): void => {
    if (picked.includes(id)) {
      setPicked((list) => list.filter((x) => x !== id));
      if (opening?.card_id === id) setOpening(null);
    } else if (picked.length >= MAX_CARDS) {
      overlay.toast(t("newScenario.tooMany"), { icon: "alert" });
    } else {
      setPicked((list) => [...list, id]);
    }
  };
  const move = (index: number, delta: -1 | 1): void =>
    setPicked((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(target, 0, item);
      return next;
    });

  const back = (): void => {
    if (location.key !== "default") navigate(-1);
    else navigate(scenario ? scenarioPath(scenario) : "/library", { replace: true });
  };

  const save = async (): Promise<void> => {
    if (!picked.length || !values) return;
    setSaving(true);
    setProblem(null);
    const setup: ScenarioSetup = {
      protagonist: { name: values.name, summary: values.summary },
      preferences: { length: values.length, style: values.style, boundaries: values.boundaries },
      opening,
    };
    try {
      if (scenario) {
        const updated = await api.scenarios.update(scenario.id, {
          name: name.trim() || undefined,
          card_ids: picked,
          setup,
          version: scenario.version,
        });
        queries.setQueryData(["scenario", scenario.id], updated);
        void queries.invalidateQueries({ queryKey: scenariosKey });
        overlay.toast(t("scenario.saved"));
        navigate(scenarioPath(updated), { replace: true });
      } else {
        const created = await api.scenarios.create({ name: name.trim() || null, card_ids: picked, setup });
        void queries.invalidateQueries({ queryKey: scenariosKey });
        overlay.toast(t("newScenario.created", { name: created.name }));
        navigate(scenarioPath(created), { replace: true });
      }
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.code === "SCENARIO_CHANGED" && scenario) {
        overlay.toast(t("scenario.changed"), { icon: "info" });
        await queries.invalidateQueries({ queryKey: ["scenario", scenario.id] });
        return;
      }
      setProblem(describeError(e));
    }
  };

  const openings: { value: Opening; title: string; text: string }[] = [
    { value: null, title: t("newScenario.openingDirector"), text: "" },
  ];
  for (const id of picked) {
    const detail = detailOf.get(id);
    if (!detail) continue;
    const cardName = detail.card.name;
    if (detail.content.first_mes.trim()) {
      openings.push({
        value: { card_id: id, greeting: 0 },
        title: t("newScenario.greetingFirst", { card: cardName }),
        text: detail.content.first_mes,
      });
    }
    detail.content.alternate_greetings.forEach((text, i) => {
      if (!text.trim()) return;
      openings.push({
        value: { card_id: id, greeting: i + 1 },
        title: t("newScenario.greetingAlt", { card: cardName, n: i + 1 }),
        text,
      });
    });
  }
  const sameOpening = (a: Opening, b: Opening): boolean =>
    a === b || (!!a && !!b && a.card_id === b.card_id && a.greeting === b.greeting);

  const title = scenario ? t("newScenario.editTitle") : t("newScenario.title");
  return (
    <div className={styles.formPage}>
      <header className={styles.formBar}>
        <IconButton icon="back" label={t("common.back")} onClick={back} />
        <h1 className={styles.formTitle}>{title}</h1>
        <Button
          label={scenario ? t("newScenario.save") : t("newScenario.create")}
          size="sm"
          busy={saving}
          disabled={!picked.length || !values}
          onClick={() => void save()}
        />
      </header>
      {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}

      <h2 className={styles.formSection}>{t("newScenario.pickCards")}</h2>
      <p className={styles.formHint}>
        {t("newScenario.pickHint")}
        {picked.length ? ` · ${t("newScenario.picked", { count: picked.length })}` : ""}
      </p>
      {cards.isPending ? (
        <Dots />
      ) : all.length === 0 ? (
        <Notice
          tone="info"
          message={t("newScenario.noCards")}
          actionLabel={t("library.goWorkbench")}
          onAction={() => navigate("/workbench")}
        />
      ) : (
        <div className={styles.pickList}>
          {picked.map((id, i) => {
            const card = byId.get(id);
            const label = card?.name ?? detailOf.get(id)?.card.name ?? id;
            return (
              <div key={id} className={cx(styles.pickRow, styles.pickOn)}>
                <span className={styles.pickIndex}>{i + 1}</span>
                <Cover seed={id} blobId={card?.cover_blob_id} width={40} height={40} surface="onFill" />
                <span className={styles.castBody}>
                  <span className={styles.castName}>{label}</span>
                </span>
                {i === 0 && picked.length > 1 ? <Pill label={t("scenario.lead")} tone="acc" /> : null}
                <IconButton
                  icon="chevronUp"
                  label={t("newScenario.moveUp")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  icon="chevronDown"
                  label={t("newScenario.moveDown")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  disabled={i === picked.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconButton
                  icon="close"
                  label={t("newScenario.remove")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  onClick={() => toggle(id)}
                />
              </div>
            );
          })}
          {rest.map((card) => (
            <div key={card.id} className={styles.pickRow}>
              <span className={styles.pickIndex} />
              <button type="button" className={styles.pickButton} onClick={() => toggle(card.id)}>
                <Cover seed={card.id} blobId={card.cover_blob_id} width={40} height={40} surface="onFill" />
                <span className={styles.castBody}>
                  <span className={styles.castName}>{card.name}</span>
                  <span className={styles.caption}>{card.description_preview}</span>
                </span>
              </button>
              <IconButton
                icon="plus"
                label={t("common.add")}
                tone="plain"
                diameter={32}
                iconSize={16}
                disabled={picked.length >= MAX_CARDS}
                onClick={() => toggle(card.id)}
              />
            </div>
          ))}
        </div>
      )}

      <h2 className={styles.formSection}>{t("newScenario.name")}</h2>
      <Field
        label={t("newScenario.name")}
        className={styles.hiddenLabel}
        value={name}
        maxLength={80}
        placeholder={t("newScenario.namePlaceholder")}
        onChange={(e) => setName(e.target.value)}
      />

      <h2 className={styles.formSection}>{t("newScenario.protagonist")}</h2>
      <p className={styles.formHint}>{t("newScenario.protagonistHint")}</p>
      <StartForm
        wide={wide}
        initial={
          scenario
            ? { name: scenario.setup.protagonist.name, summary: scenario.setup.protagonist.summary, ...scenario.setup.preferences }
            : undefined
        }
        onChange={(next) => setValues(next)}
      />

      <h2 className={styles.formSection}>{t("newScenario.opening")}</h2>
      <p className={styles.formHint}>{t("newScenario.openingHint")}</p>
      <div className={styles.openings} role="radiogroup" aria-label={t("newScenario.opening")}>
        {openings.map((option) => {
          const on = sameOpening(option.value, opening);
          return (
            <button
              key={option.value ? `${option.value.card_id}:${option.value.greeting}` : "director"}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(styles.opening, on && styles.openingOn)}
              onClick={() => setOpening(option.value)}
            >
              <span className={styles.openingTitle}>{option.title}</span>
              {option.text ? <span className={styles.openingText}>{option.text}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ScenarioFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { api } = useApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["scenario", id],
    queryFn: () => api.scenarios.get(id ?? ""),
    enabled: !!id,
  });
  useDocumentTitle(id ? t("newScenario.editTitle") : t("newScenario.title"));
  if (!id) return <Form scenario={null} presetCard={params.get("card")} />;
  if (!query.data) {
    return (
      <div className={styles.formPage}>
        <header className={styles.formBar}>
          <IconButton icon="back" label={t("common.back")} onClick={() => navigate("/library")} />
          <h1 className={styles.formTitle}>{t("newScenario.editTitle")}</h1>
        </header>
        {query.error ? (
          <Notice
            message={t("scenario.loadFailedWith", { error: describeError(query.error) })}
            actionLabel={t("common.reload")}
            onAction={() => void query.refetch()}
          />
        ) : (
          <Dots />
        )}
      </div>
    );
  }
  // 版本号变了（别处改过、重新读了）就从头填一遍
  return <Form key={query.data.version} scenario={query.data} presetCard={null} />;
}
