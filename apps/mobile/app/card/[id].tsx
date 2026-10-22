/**
 * 角色卡详情（同网页端 pages/cards/CardPage.tsx）：封面、名字、来源和作者、标签；在工作台里改、用这张卡新建剧本；
 * 描述、开场白和世界书的条数；在用的剧本；参考资料；版本历史（可以恢复旧版）；删除（有剧本在用时不能删）。
 * 导出 PNG / JSON 只在网页端（手机上没有存文件的地方）。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { CardRevision } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin, fieldList } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../src/components/Cover.tsx";
import {
  BackBar,
  Button,
  ErrorState,
  Group,
  ListRow,
  Loading,
  Notice,
  Page,
  Pill,
  SectionHeader,
  useOverlay,
} from "../../src/components/ui.tsx";
import { useCardActions } from "../../src/features/library/cardActions.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, type as typography, usePalette } from "../../src/theme/index.ts";

function revisionNote(revision: CardRevision): string {
  const restored = /^restore:(\d+)$/.exec(revision.note);
  if (restored) return i18n.t("cards.restored", { n: Number(restored[1]) });
  return revision.from_draft ? i18n.t("cards.fromDraft") : revision.note;
}

export default function CardScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const palette = usePalette();
  const { width } = useLayout();
  const { t } = useTranslation();
  const actions = useCardActions();
  const detail = useAsync(() => api.cards.get(id), [api, id]);
  const revisions = useAsync(() => api.cards.revisions(id), [api, id]);
  const [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!detail.data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <BackBar />
        {detail.loading ? (
          <Loading />
        ) : (
          <ErrorState
            title={t("cards.loadFailed")}
            message={describeError(detail.error)}
            onRetry={() => void detail.reload()}
          />
        )}
      </View>
    );
  }
  const { card, content } = detail.data;
  const coverWidth = Math.min(width, 640) - space.page * 2;

  const edit = async (): Promise<void> => {
    setOpening(true);
    try {
      await actions.edit(card);
    } finally {
      setOpening(false);
    }
  };

  const restore = async (revision: CardRevision): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("cards.restoreConfirm", { n: revision.version }),
      message: t("cards.restoreMessage"),
      confirmLabel: t("cards.restore"),
      icon: "history",
    });
    if (!ok) return;
    try {
      const restored = await api.cards.restore(card.id, revision.version);
      detail.setData(() => restored);
      void revisions.reload();
      overlay.toast(t("cards.restoreDone", { n: revision.version }));
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const caption = [
    ...new Set([
      cardOrigin(card),
      card.creator ? t("library.byCreator", { creator: card.creator }) : "",
      formatRelative(card.updated_at),
    ]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Page header={<BackBar />} contentStyle={styles.content}>
      <Cover seed={card.id} blobId={card.cover_blob_id} width={coverWidth} height={Math.round(coverWidth * 0.62)} rounded={28} />
      <Text style={[styles.caption, { color: palette.mut }]}>{caption}</Text>
      <Text style={[typography.hero, { color: palette.ink }]}>{card.name}</Text>
      {card.character_name && card.character_name !== card.name ? (
        <Text style={[styles.caption, { color: palette.mut }]}>{card.character_name}</Text>
      ) : null}
      {card.ip ? <Text style={[styles.caption, { color: palette.mut }]}>{t("cards.ip", card.ip)}</Text> : null}
      {card.tags.length ? (
        <View style={styles.tags}>
          {card.tags.slice(0, 12).map((tag) => (
            <Pill key={tag} label={tag} />
          ))}
        </View>
      ) : null}
      {card.draft_id ? (
        <Notice
          tone="info"
          message={t("library.unsavedDraft")}
          actionLabel={t("common.open")}
          onAction={() => router.push({ pathname: "/workbench/[id]", params: { id: card.draft_id ?? "" } })}
        />
      ) : null}
      <Button label={t("cards.openInWorkbench")} icon="workbench" busy={opening} onPress={() => void edit()} />
      <Button label={t("cards.newScenario")} icon="plus" variant="secondary" onPress={() => actions.newScenario(card)} />

      {content.description.trim() ? (
        <Pressable onPress={() => setExpanded((v) => !v)} style={[styles.panel, { backgroundColor: palette.bg2 }]}>
          <Text numberOfLines={expanded ? undefined : 6} style={{ fontSize: 15, lineHeight: 24, color: palette.ink2 }}>
            {content.description}
          </Text>
          <Text style={{ fontSize: 13.5, color: palette.acc }}>
            {expanded ? t("scenario.collapse") : t("scenario.expand")}
          </Text>
        </Pressable>
      ) : null}
      <Text style={[styles.caption, { color: palette.mut }]}>
        {t("workbench.preview.greetings", { count: card.greetings })} ·{" "}
        {t("workbench.preview.entries", { count: card.book_entries })}
      </Text>

      <SectionHeader title={t("cards.usedBy")} style={styles.section} />
      {detail.data.scenarios.length ? (
        <Group>
          {detail.data.scenarios.map((s) => (
            <ListRow
              key={s.id}
              title={s.name}
              chevron
              onPress={() => router.push({ pathname: "/scenario/[id]", params: { id: s.id } })}
            />
          ))}
        </Group>
      ) : (
        <Text style={[styles.caption, { color: palette.mut }]}>{t("cards.notUsed")}</Text>
      )}

      {detail.data.sources.length ? (
        <>
          <SectionHeader title={t("cards.sources")} style={styles.section} />
          <Group>
            {detail.data.sources.map((source) => (
              <ListRow
                key={source.url}
                title={source.title || source.url}
                subtitle={
                  source.used_in.length
                    ? t("workbench.preview.usedIn", { fields: fieldList(source.used_in) })
                    : undefined
                }
                onPress={() => void Linking.openURL(source.url)}
              />
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader title={t("cards.revisions")} style={styles.section} />
      <Group>
        {(revisions.data ?? []).map((revision) => {
          const current = revision.version === card.version;
          return (
            <ListRow
              key={revision.version}
              title={`${t("cards.version", { n: revision.version })}${current ? ` · ${t("cards.current")}` : ""}`}
              subtitle={[revisionNote(revision), formatRelative(revision.created_at)].filter(Boolean).join(" · ")}
              trailing={
                current ? null : (
                  <Button
                    label={t("cards.restore")}
                    variant="secondary"
                    onGrey
                    onPress={() => void restore(revision)}
                    style={{ minHeight: 36, height: 36, paddingHorizontal: space.m }}
                  />
                )
              }
            />
          );
        })}
      </Group>

      <Button
        label={t("cards.delete")}
        variant="danger"
        icon="trash"
        onPress={() =>
          void actions.remove(card).then((gone) => {
            if (gone) router.back();
          })
        }
        style={{ marginTop: space.xl }}
      />
      <Text style={[styles.caption, { color: palette.mut, textAlign: "center" }]}>{t("cards.deleteMessage")}</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, gap: space.m },
  caption: { fontSize: 13, lineHeight: 19 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  panel: { padding: 16, borderRadius: 28, gap: space.s },
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
});
