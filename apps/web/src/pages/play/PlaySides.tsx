/**
 * 阅读页左右两栏（docs/design/comic 的 09），跟着页面滚动时贴在顶上：
 * - 左栏“回想”：最近几段的编号和第一句，最新的那段描黑边加投影；点一下滚到那一段。按 L（或页头的“回想”）看全部 / 收起；
 * - 右栏“这一话的人物”：世界状态里的人物，主角在最前（蓝底，写“你”）；“刚记下的”：最后记下的地点、两条事实，
 *   还没揭开的秘密有几条。点一下打开世界面板。
 * 接口里没有“章节”，也没有人物第一次出场是哪一回合，所以不写“第几话”，也不标 NEW。
 */

import { useTranslation } from "react-i18next";

import type { WorldView } from "@bettertavern/core/api/types";
import type { StoryTurn } from "@bettertavern/core/play/turnMachine";

import { Keycap, Portrait } from "../../components/comic.tsx";
import { cx } from "../../components/controls.tsx";
import styles from "./play.module.css";
import { castOf, recapItems, recentNotes } from "./reading.ts";
import { turnAnchor } from "./StoryFeed.tsx";

export function RecapColumn({
  turns,
  all,
  onToggle,
}: {
  turns: StoryTurn[];
  all: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const items = recapItems(turns, all);
  const last = items.at(-1)?.id;
  return (
    <nav className={styles.recap} aria-label={t("play.recap.title")}>
      <span className={styles.sideLabel}>{t("play.recap.title")}</span>
      <ol className={styles.recapList}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={cx(styles.recapItem, item.id === last && styles.recapOn)}
              onClick={() => {
                const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                document.getElementById(turnAnchor(item.seq))?.scrollIntoView({
                  behavior: reduced ? "auto" : "smooth",
                  block: "start",
                });
              }}
            >
              <b>{item.seq}</b>
              <span>{item.text}</span>
            </button>
          </li>
        ))}
      </ol>
      {turns.length > 5 ? (
        <button type="button" className={styles.recapMore} onClick={onToggle} aria-keyshortcuts="L">
          <Keycap>L</Keycap>
          {all ? t("play.recap.fewer") : t("play.recap.all")}
        </button>
      ) : null}
    </nav>
  );
}

export function CastColumn({ view, onOpenWorld }: { view: WorldView | undefined; onOpenWorld: () => void }) {
  const { t } = useTranslation();
  if (!view) return <aside className={styles.cast} aria-label={t("play.cast.title")} />;
  const cast = castOf(view.entities);
  const notes = recentNotes(view);
  const hasNotes = notes.place || notes.facts.length > 0 || notes.hidden > 0;
  return (
    <aside className={styles.cast} aria-label={t("play.cast.title")}>
      {cast.length > 0 ? (
        <>
          <span className={styles.sideLabel}>{t("play.cast.title")}</span>
          <div className={styles.castList}>
            {cast.map((entity) => (
              <button
                key={entity.id}
                type="button"
                className={cx(styles.castItem, entity.is_protagonist && styles.castMe)}
                onClick={onOpenWorld}
              >
                <Portrait
                  name={entity.name}
                  seed={entity.id}
                  tone={entity.is_protagonist ? "ink" : undefined}
                  size={40}
                  radius={8}
                  className={styles.castFace}
                />
                <span className={styles.castText}>
                  <b>
                    {entity.name}
                    {entity.is_protagonist ? ` · ${t("play.you")}` : null}
                  </b>
                  {entity.summary ? <span>{entity.summary}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {hasNotes ? (
        <>
          <span className={styles.sideLabel}>{t("play.cast.notes")}</span>
          <div className={styles.notes}>
            {notes.place ? (
              <button type="button" className={styles.note} onClick={onOpenWorld}>
                <b>{t("play.cast.place")}</b>
                <span>
                  {notes.place.name}
                  {notes.place.summary ? ` · ${notes.place.summary}` : null}
                </span>
              </button>
            ) : null}
            {notes.facts.map((fact) => (
              <button key={fact.id} type="button" className={styles.note} onClick={onOpenWorld}>
                <b>{t("play.cast.fact")}</b>
                <span>{fact.text}</span>
              </button>
            ))}
            {notes.hidden > 0 ? (
              <button type="button" className={styles.note} onClick={onOpenWorld}>
                <b>{t("play.cast.secret")}</b>
                <span className={styles.noteMuted}>{t("play.cast.hidden", { count: notes.hidden })}</span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}
