/**
 * 新建剧本（?card= 预先选好一张）和编辑剧本（?id=），同网页端 pages/scenario/ScenarioFormPage.tsx：
 * 1. 从角色卡仓库选一张或几张卡（最多 8 张，群像剧本），可以调先后，第一张是主角色；
 * 2. 剧本名（不填就用第一张卡的名字）；
 * 3. 默认主角和偏好：开新故事时预填（和“开始新的故事”是同一个表单，StartForm.tsx）；
 * 4. 开场：用其中一张卡的开场白或某条备选开场白（导演不重写），或者让导演根据设定写一个。
 * 编辑时带版本号保存，别处改过（409 SCENARIO_CHANGED）就重新读一次。
 *
 * 漫画风（docs/design/comic/mobile/png/19）：选好的卡在一个墨线格子里，序号是墨底方块，第一张标“主角色”；
 * 还没选的卡在下面另一个格子里；开场是墨线格子里的单选行。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { CardDetail, Scenario, ScenarioSetup } from "@bettertavern/core/api/types";

import { Cover } from "../../src/components/Cover.tsx";
import {
  ErrorState,
  Field,
  Group,
  Icon,
  IconButton,
  Loading,
  NavBar,
  Notice,
  Pill,
  RadioMark,
  SectionHeader,
  Toggle,
  useColumnStyle,
  useOverlay,
} from "../../src/components/ui.tsx";
import { StartForm, type StartValues } from "../../src/features/scenario/StartForm.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { comicRadius, font, space, useComic } from "../../src/theme/index.ts";

const MAX_CARDS = 8;

type Opening = ScenarioSetup["opening"];

function Form({ scenario, presetCard, onChanged }: { scenario: Scenario | null; presetCard: string | null; onChanged: () => void }) {
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const c = useComic();
  const column = useColumnStyle();
  const { t } = useTranslation();
  const cards = useAsync(() => api.cards.list(), [api]);
  const [picked, setPicked] = useState<string[]>(() =>
    scenario ? scenario.cards.map((c) => c.card_id) : presetCard ? [presetCard] : [],
  );
  const [name, setName] = useState(scenario?.name ?? "");
  const [values, setValues] = useState<StartValues | null>(null);
  const [opening, setOpening] = useState<Opening>(scenario?.setup.opening ?? null);
  const [lightning, setLightning] = useState(scenario?.setup.lightning ?? false);
  const [details, setDetails] = useState<Map<string, CardDetail>>(new Map());
  // 取过的卡（取不到的也算），不反复取
  const requested = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // 选了的卡的全文（列开场白用）
  useEffect(() => {
    const missing = picked.filter((id) => !requested.current.has(id));
    if (!missing.length) return;
    for (const id of missing) requested.current.add(id);
    void Promise.all(missing.map((id) => api.cards.get(id).catch(() => null))).then((found) =>
      setDetails((map) => {
        const next = new Map(map);
        for (const d of found) if (d) next.set(d.card.id, d);
        return next;
      }),
    );
  }, [api, picked]);

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

  const save = async (): Promise<void> => {
    if (!picked.length || !values) return;
    setSaving(true);
    setProblem(null);
    const setup: ScenarioSetup = {
      protagonist: { name: values.name, summary: values.summary },
      preferences: { length: values.length, style: values.style, boundaries: values.boundaries },
      opening,
      lightning,
    };
    try {
      if (scenario) {
        await api.scenarios.update(scenario.id, {
          name: name.trim() || undefined,
          card_ids: picked,
          setup,
          version: scenario.version,
        });
        overlay.toast(t("scenario.saved"));
        router.back();
      } else {
        const created = await api.scenarios.create({ name: name.trim() || null, card_ids: picked, setup });
        overlay.toast(t("newScenario.created", { name: created.name }));
        router.replace({ pathname: "/scenario/[id]", params: { id: created.id } });
      }
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.code === "SCENARIO_CHANGED" && scenario) {
        overlay.toast(t("scenario.changed"), { icon: "info" });
        onChanged();
        return;
      }
      setProblem(describeError(e));
    }
  };

  const openings: { value: Opening; title: string; text: string }[] = [
    { value: null, title: t("newScenario.openingDirector"), text: "" },
  ];
  for (const id of picked) {
    const detail = details.get(id);
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
  const same = (a: Opening, b: Opening): boolean =>
    a === b || (!!a && !!b && a.card_id === b.card_id && a.greeting === b.greeting);

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <NavBar
        title={scenario ? t("newScenario.editTitle") : t("newScenario.title")}
        actions={
          picked.length && values && !saving
            ? [{ icon: "check", label: scenario ? t("newScenario.save") : t("newScenario.create"), onPress: () => void save() }]
            : []
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.content, column]} keyboardShouldPersistTaps="handled">
          {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}

          <SectionHeader
            title={t("newScenario.pickCards")}
            meta={picked.length ? t("newScenario.picked", { count: picked.length }) : undefined}
            style={styles.section}
          />
          <Text style={[styles.hint, { color: c.mut }]}>{t("newScenario.pickHint")}</Text>
          {cards.loading && !cards.data ? (
            <Loading />
          ) : all.length === 0 ? (
            <Notice
              tone="info"
              message={t("newScenario.noCards")}
              actionLabel={t("library.goWorkbench")}
              onAction={() => router.navigate("/workbench")}
            />
          ) : (
            <View style={{ gap: space.m }}>
              {picked.length ? (
                <Group>
                  {picked.map((id, i) => {
                    const card = byId.get(id);
                    return (
                      <View key={id} style={styles.pick}>
                        <View style={[styles.index, { backgroundColor: c.ink }]}>
                          <Text style={[styles.indexText, { color: c.paper }]}>{i + 1}</Text>
                        </View>
                        <Cover seed={id} blobId={card?.cover_blob_id} width={40} height={40} rounded={7} framed />
                        <Text numberOfLines={1} style={[styles.pickName, { color: c.ink }]}>
                          {card?.name ?? details.get(id)?.card.name ?? id}
                        </Text>
                        {i === 0 && picked.length > 1 ? <Pill label={t("scenario.lead")} tone="accSolid" /> : null}
                        <IconButton icon="chevronUp" label={t("newScenario.moveUp")} tone="plain" diameter={32} size={18} disabled={i === 0} onPress={() => move(i, -1)} />
                        <IconButton
                          icon="chevronDown"
                          label={t("newScenario.moveDown")}
                          tone="plain"
                          diameter={32}
                          size={18}
                          disabled={i === picked.length - 1}
                          onPress={() => move(i, 1)}
                        />
                        <IconButton icon="close" label={t("newScenario.remove")} tone="plain" diameter={32} size={18} onPress={() => toggle(id)} />
                      </View>
                    );
                  })}
                </Group>
              ) : null}
              {rest.length ? (
                <Group>
                  {rest.map((card) => (
                    <Pressable
                      key={card.id}
                      accessibilityRole="button"
                      onPress={() => toggle(card.id)}
                      style={({ pressed }) => [styles.pick, { backgroundColor: pressed ? c.grey : "transparent" }]}
                    >
                      <View style={styles.index}>
                        <Icon name="plus" size={18} color={c.mut} />
                      </View>
                      <Cover seed={card.id} blobId={card.cover_blob_id} width={40} height={40} rounded={7} framed />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[styles.pickName, { color: c.ink }]}>
                          {card.name}
                        </Text>
                        <Text numberOfLines={1} style={{ fontSize: 12.5, color: c.mut }}>
                          {card.description_preview}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </Group>
              ) : null}
            </View>
          )}

          <SectionHeader title={t("newScenario.name")} style={styles.section} />
          <Field
            label={t("newScenario.name")}
            hideLabel
            value={name}
            maxLength={80}
            placeholder={t("newScenario.namePlaceholder")}
            onChangeText={setName}
          />

          <SectionHeader title={t("newScenario.protagonist")} style={styles.section} />
          <Text style={[styles.hint, { color: c.mut }]}>{t("newScenario.protagonistHint")}</Text>
          {/* 五步的格子自己离边 20：抵掉这一页的左右边距 */}
          <View style={{ marginHorizontal: -space.page }}>
            <StartForm
              initial={
                scenario
                  ? { name: scenario.setup.protagonist.name, summary: scenario.setup.protagonist.summary, ...scenario.setup.preferences }
                  : undefined
              }
              onChange={(next) => setValues(next)}
            />
          </View>

          <SectionHeader title={t("newScenario.opening")} style={styles.section} />
          <Text style={[styles.hint, { color: c.mut }]}>{t("newScenario.openingHint")}</Text>
          <View accessibilityRole="radiogroup">
            <Group>
              {openings.map((option) => {
                const on = same(option.value, opening);
                return (
                  <Pressable
                    key={option.value ? `${option.value.card_id}:${option.value.greeting}` : "director"}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setOpening(option.value)}
                    style={({ pressed }) => [styles.opening, { backgroundColor: pressed ? c.grey : "transparent" }]}
                  >
                    <RadioMark selected={on} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: "700", color: c.ink }}>{option.title}</Text>
                      {option.text ? (
                        <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 20, color: c.mut }}>
                          {option.text}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </Group>
          </View>

          <SectionHeader title={t("newScenario.lightning")} style={styles.section} />
          <View style={styles.switchRow}>
            <Text style={[styles.hint, styles.switchHint, { color: c.mut }]}>
              {t("newScenario.lightningHint")}
            </Text>
            <Toggle value={lightning} onChange={setLightning} label={t("newScenario.lightning")} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function ScenarioFormScreen() {
  const { id, card } = useLocalSearchParams<{ id?: string; card?: string }>();
  const { api } = useApp();
  const c = useComic();
  const { t } = useTranslation();
  const scenario = useAsync(() => (id ? api.scenarios.get(id) : Promise.resolve(null)), [api, id]);
  if (!id) return <Form scenario={null} presetCard={card ?? null} onChanged={() => undefined} />;
  if (!scenario.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <NavBar title={t("newScenario.editTitle")} />
        {scenario.loading ? (
          <Loading />
        ) : (
          <ErrorState
            title={t("scenario.loadFailed")}
            message={describeError(scenario.error)}
            onRetry={() => void scenario.reload()}
          />
        )}
      </View>
    );
  }
  // 版本号变了（别处改过、重新读了）就从头填一遍
  return (
    <Form key={scenario.data.version} scenario={scenario.data} presetCard={null} onChanged={() => void scenario.reload()} />
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.l },
  switchHint: { flex: 1 },
  content: { paddingHorizontal: space.page, paddingTop: space.s, paddingBottom: 56, gap: space.m },
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
  hint: { fontSize: 13, lineHeight: 20, marginTop: -space.s },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: space.m },
  index: { width: 26, height: 26, borderRadius: comicRadius.tag, alignItems: "center", justifyContent: "center" },
  indexText: { fontFamily: font.monoMedium, fontSize: 13, fontWeight: "700" },
  pickName: { flex: 1, fontSize: 15.5, fontWeight: "900" },
  opening: { flexDirection: "row", alignItems: "flex-start", gap: space.m, paddingVertical: 14, paddingHorizontal: 14 },
});
