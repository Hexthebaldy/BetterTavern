/**
 * 角色卡详情（同网页端 pages/cards/CardPage.tsx）：封面、名字、来源和作者、标签；在工作台里改、用这张卡新建剧本；
 * 描述、开场白和世界书的条数；在用的剧本；参考资料；版本历史（可以恢复旧版）；删除（有剧本在用时不能删）。
 * 导出 PNG / JSON 只在网页端（手机上没有存文件的地方）。
 *
 * 漫画风（docs/design/comic/mobile/png/18）：封面是墨线的格子；标签是白底墨框的小标签；
 * 世界书、开场白、版本三个数字格；描述不进框，下面“展开全文”；在用的剧本和版本历史是墨线格子里的列表行。
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
import { comicRadius, comicStroke, ctype, font, space, useComic } from "../../src/theme/index.ts";

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
  const c = useComic();
  const { width } = useLayout();
  const { t } = useTranslation();
  const actions = useCardActions();
  const detail = useAsync(() => api.cards.get(id), [api, id]);
  const revisions = useAsync(() => api.cards.revisions(id), [api, id]);
  const [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!detail.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
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
  const coverWidth = Math.min(width, 640) - space.page * 2 - comicStroke.frame * 2;

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
      <View style={[styles.cover, { borderColor: c.ink }]}>
        <Cover seed={card.id} blobId={card.cover_blob_id} width={coverWidth} height={Math.round(coverWidth * 0.56)} rounded={0} />
      </View>
      <Text style={[styles.caption, { color: c.mut }]}>{caption}</Text>
      <Text style={[styles.name, { color: c.ink }]}>{card.name}</Text>
      {card.character_name && card.character_name !== card.name ? (
        <Text style={[styles.caption, { color: c.mut }]}>{card.character_name}</Text>
      ) : null}
      {card.ip ? <Text style={[styles.caption, { color: c.mut }]}>{t("cards.ip", card.ip)}</Text> : null}
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

      <View style={styles.stats}>
        {[
          { n: card.book_entries, label: t("cards.statEntries") },
          { n: card.greetings, label: t("cards.statGreetings") },
          { n: card.version, label: t("cards.statVersions") },
        ].map((stat) => (
          <View
            key={stat.label}
            accessible
            accessibilityLabel={`${stat.label} ${stat.n}`}
            style={[styles.stat, { borderColor: c.ink, backgroundColor: c.paper }]}
          >
            <Text style={[styles.statNumber, { color: c.ink }]}>{stat.n}</Text>
            <Text numberOfLines={2} style={[styles.statLabel, { color: c.mut }]}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
      {content.description.trim() ? (
        <Pressable accessibilityState={{ expanded }} onPress={() => setExpanded((v) => !v)} style={styles.description}>
          <Text numberOfLines={expanded ? undefined : 6} style={{ fontSize: 15, lineHeight: 26, color: c.ink2 }}>
            {content.description}
          </Text>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: c.acc }}>
            {expanded ? t("scenario.collapse") : t("scenario.expand")}
          </Text>
        </Pressable>
      ) : null}

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
        <Text style={[styles.caption, { color: c.mut }]}>{t("cards.notUsed")}</Text>
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
              title={t("cards.version", { n: revision.version })}
              subtitle={[revisionNote(revision), formatRelative(revision.created_at)].filter(Boolean).join(" · ")}
              trailing={
                current ? (
                  <Pill tone="ink" label={t("cards.current")} />
                ) : (
                  <Button label={t("cards.restore")} variant="text" small onPress={() => void restore(revision)} />
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
      <Text style={[styles.caption, { color: c.mut, textAlign: "center" }]}>{t("cards.deleteMessage")}</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, gap: space.m },
  cover: { borderWidth: comicStroke.frame, borderRadius: comicRadius.frame, overflow: "hidden" },
  caption: { fontSize: 13, lineHeight: 19 },
  name: { ...ctype.title, fontSize: 30, lineHeight: 38 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: space.m,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  statNumber: { fontFamily: font.monoMedium, fontSize: 20, lineHeight: 26, fontWeight: "700" },
  statLabel: { fontSize: 12.5, lineHeight: 17 },
  description: { gap: space.s },
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
});
