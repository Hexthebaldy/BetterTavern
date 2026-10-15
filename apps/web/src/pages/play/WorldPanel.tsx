/**
 * 世界状态面板（W06、W07、W10、W11）：导演记下的人物与地点、关系图、事实。数据来自 GET /v1/playthroughs/{id}/world。
 * 主角不知道的秘密默认隐藏，揭示前要确认（会剧透，默认焦点在“取消”）；揭示后标为“秘密 · 已揭示”。
 *
 * 形态由 theme/layout.ts 的 readingLayout 决定：
 * - dock：停靠在右侧，宽 400，离窗口右、上、下各 12，圆角 28，灰底，不加遮罩；右上角是收起按钮（侧栏图标）；
 * - slideOver：同样的面板从右侧滑出，后面有遮罩，右上角是 ×，点遮罩或按 Esc 关闭；
 * - sheet（手机宽度）：同上，左右各离窗口 8。
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { describeError } from "@bettertavern/core/api/client";

import { Button, cx, Dots, IconButton } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import type { WorldMode } from "../../theme/layout.ts";
import styles from "./world.module.css";
import { Entities, Facts, Links, type Tab } from "./WorldParts.tsx";

/** 取世界状态、揭示秘密；version 变了（新的一段写完）就重新取 */
function useWorld(playthroughId: string, version: string | null) {
  const { api } = useApp();
  const overlay = useOverlay();
  const [revealed, setRevealed] = useState(false);
  const query = useQuery({
    queryKey: ["world", playthroughId, revealed, version],
    queryFn: () => api.playthroughs.world(playthroughId, revealed),
    placeholderData: (previous) => previous,
  });
  const reveal = async (): Promise<void> => {
    const count = query.data?.hidden_facts ?? 0;
    const ok = await overlay.confirm({
      title: count > 1 ? `揭示 ${count} 条秘密？` : "揭示一条秘密？",
      message: "这是导演知道、而“我”还不知道的事，看了会剧透接下来的故事。",
      confirmLabel: "揭示",
      tone: "warn",
      icon: "lock",
    });
    if (ok) setRevealed(true);
  };
  return { query, reveal };
}

function WorldContent({
  playthroughId,
  version,
  mode,
  onClose,
}: {
  playthroughId: string;
  version: string | null;
  mode: WorldMode;
  onClose: () => void;
}) {
  const { query, reveal } = useWorld(playthroughId, version);
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
    { value: "entities", label: "人物与地点", count: counts?.entities },
    { value: "links", label: "关系", count: counts?.links },
    { value: "facts", label: "事实", count: counts?.facts },
  ];
  const docked = mode === "dock";
  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title}>世界</h2>
          <span className={styles.subtitle}>导演记下的一切 · 开局时整理</span>
        </div>
        <IconButton
          icon={docked ? "sidebar" : "close"}
          label={docked ? "收起世界状态" : "关闭"}
          aria-keyshortcuts={docked ? "W" : "Escape"}
          iconSize={docked ? 20 : 22}
          onClick={onClose}
        />
      </div>
      <div className={styles.tabs} role="tablist" aria-label="世界状态">
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
            <p>世界状态没加载出来：{describeError(query.error)}</p>
            <Button label="重试" icon="retry" variant="secondary" onClick={() => void query.refetch()} />
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
  onClose,
}: {
  mode: WorldMode;
  playthroughId: string;
  /** 故事的最新一段：变了就重新取世界状态 */
  version: string | null;
  onClose: () => void;
}) {
  const content = (
    <WorldContent playthroughId={playthroughId} version={version} mode={mode} onClose={onClose} />
  );
  if (mode === "dock") {
    return (
      <aside className={cx(styles.panel, styles.dock, "surface-panel")} aria-label="世界状态">
        {content}
      </aside>
    );
  }
  return (
    <Dialog
      label="世界状态"
      onClose={onClose}
      className={cx(styles.panel, styles.slideOver, mode === "sheet" && styles.sheet, "surface-panel")}
      bare
    >
      {content}
    </Dialog>
  );
}
