/**
 * 世界状态面板（W06、W07、W10、W11）：导演记下的人物与地点、关系图、事实。数据来自 GET /v1/playthroughs/{id}/world。
 * 主角不知道的秘密默认隐藏，揭示前要确认（会剧透，默认焦点在“取消”）；揭示后标为“秘密 · 已揭示”。
 *
 * 形态由 theme/layout.ts 的 worldMode 决定：
 * - slideOver：从右侧滑出，宽 400，后面有遮罩，右上角是 ×，点遮罩或按 Esc 关闭；
 * - sheet（手机宽度）：同上，左右各离窗口 8。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import { worldIssue, worldProgress } from "@bettertavern/core/play/worldStatus";

import { Button, cx, Dots, IconButton, Notice } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import type { WorldMode } from "../../theme/layout.ts";
import { useWorld, type Head } from "./useWorld.ts";
import styles from "./world.module.css";
import { Entities, Facts, Links, type Tab } from "./WorldParts.tsx";

function WorldContent({
  playthroughId,
  head,
  mode,
  onClose,
}: {
  playthroughId: string;
  head: Head;
  mode: WorldMode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { query, reveal } = useWorld(playthroughId, head);
  const [tab, setTab] = useState<Tab>("entities");
  const view = query.data;
  const names = useMemo(() => new Map((view?.entities ?? []).map((e) => [e.id, e.name])), [view]);
  const counts = view
    ? {
        entities: view.entities.filter((e) => e.kind !== "world").length,
        links: view.links.length,
        facts: view.facts.length + view.hidden_facts,
      }
    : null;
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "entities", label: t("world.tabs.entities"), count: counts?.entities },
    { value: "links", label: t("world.tabs.links"), count: counts?.links },
    { value: "facts", label: t("world.tabs.facts"), count: counts?.facts },
  ];
  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title}>{t("world.title")}</h2>
          {view ? <span className={styles.subtitle}>{worldProgress(view)}</span> : null}
        </div>
        <IconButton icon="close" label={t("common.close")} aria-keyshortcuts="Escape" onClick={onClose} />
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t("play.world")}>
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={cx(styles.tab, tab === t.value && styles.tabOn)}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.count !== undefined ? <span className={styles.count}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className={styles.body} role="tabpanel">
        {view && worldIssue(view) ? (
          <Notice tone="warn" message={worldIssue(view)} className={styles.issue} />
        ) : null}
        {view ? (
          tab === "entities" ? (
            <Entities view={view} names={names} />
          ) : tab === "links" ? (
            <Links
              view={view}
              names={names}
              width={mode === "sheet" ? Math.min(window.innerWidth - 16, 480) : 400}
            />
          ) : (
            <Facts view={view} names={names} onReveal={() => void reveal()} />
          )
        ) : query.error ? (
          <div className={styles.error}>
            <p>{t("world.loadFailedWith", { error: describeError(query.error) })}</p>
            <Button
              label={t("common.retry")}
              icon="retry"
              variant="secondary"
              onClick={() => void query.refetch()}
            />
          </div>
        ) : (
          <div className={styles.loading}>
            <Dots />
          </div>
        )}
      </div>
    </>
  );
}

export function WorldPanel({
  mode,
  playthroughId,
  version,
  headSeq,
  onClose,
}: {
  mode: WorldMode;
  playthroughId: string;
  /** 故事的最新一段：变了就重新取世界状态 */
  version: string | null;
  /** 最新一段的序号：后台还没整理到它时，每隔一会儿再取 */
  headSeq: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const content = (
    <WorldContent playthroughId={playthroughId} head={{ version, headSeq }} mode={mode} onClose={onClose} />
  );
  return (
    <Dialog
      label={t("play.world")}
      onClose={onClose}
      className={cx(styles.panel, styles.slideOver, mode === "sheet" && styles.sheet)}
      bare
    >
      {content}
    </Dialog>
  );
}
